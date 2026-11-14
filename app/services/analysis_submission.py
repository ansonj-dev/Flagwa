from shapely.geometry import shape
from sqlalchemy import select

from app.core.exceptions import FlagwaError
from app.models import ContextLayer, Location, SatelliteScene
from app.services.catalog import scene_model
from app.services.nisar.compatibility import area, compatibility
from app.services.processing.capabilities import CAPABILITIES
from app.services.study_areas import study_context


def prepare_advanced(session, theme, payload, aoi_override=None, boundary_override=None):
    location = session.scalar(select(Location).where(Location.slug == payload.location_slug))
    if location is None or location.geometry is None:
        raise FlagwaError("AOI_NOT_CONFIGURED", "A configured study polygon is required", 422)
    identifiers = payload.scene_ids if theme == "agriculture" else [payload.scene_id] if theme in {"glacier", "deformation"} else [payload.before_scene_id, payload.after_scene_id]
    scenes = []
    for identifier in identifiers:
        scene = session.scalar(select(SatelliteScene).where(SatelliteScene.scene_id == identifier))
        if scene is None:
            raise FlagwaError("SCENE_NOT_FOUND", "Every input must be a known catalogue scene", 404)
        if scene.download_status != "COMPLETED" or not scene.file_path:
            raise FlagwaError("SCENE_NOT_DOWNLOADED", "All source scenes must have completed authorized acquisitions", 409)
        if scene.product_type != CAPABILITIES[theme]["product"] or scene.data_maturity not in {"VALIDATED", "PROVISIONAL"}:
            raise FlagwaError("WRONG_PRODUCT_TYPE", "Product type and maturity do not meet this theme's requirements", 422)
        scenes.append(scene)
    aoi, boundary = study_context(session, location)
    aoi = aoi_override or aoi
    boundary = boundary_override or boundary
    if theme in {"forest", "wildfire", "agriculture"}:
        for scene in scenes[1:]:
            terms = [payload.polarization] + ([payload.cross_polarization] if theme != "agriculture" else [])
            for term in terms:
                report = compatibility(scene_model(scenes[0]), scene_model(scene), aoi, term, payload.frequency_group)
                if not report["compatible"]:
                    raise FlagwaError("INCOMPATIBLE_SCENES", "; ".join(report["blockers"]), 422)
        if theme == "agriculture" and any(first.acquisition_datetime >= second.acquisition_datetime for first, second in zip(scenes, scenes[1:])):
            raise FlagwaError("INVALID_TIME_SERIES", "Supply scenes in strictly increasing acquisition order", 422)
        if theme == "wildfire" and not scenes[0].acquisition_datetime < payload.event_datetime < scenes[1].acquisition_datetime:
            raise FlagwaError("INVALID_EVENT_WINDOW", "The documented fire date must fall between the actual acquisitions", 422)
    else:
        normalized = scene_model(scenes[0])
        try:
            coverage = area(shape(normalized.geometry).intersection(shape(aoi))) / area(shape(aoi))
        except (TypeError, ValueError, ZeroDivisionError):
            coverage = 0
        if coverage < .98:
            raise FlagwaError("INSUFFICIENT_COVERAGE", "Selected product does not cover 98 percent of the study area", 422)
    contexts = {}

    def register(role, identifier, types, units=None):
        layer = session.get(ContextLayer, identifier)
        if layer is None or layer.location_id != location.id or layer.layer_type not in types or (units and layer.metadata_json.get("units") not in units):
            raise FlagwaError("INVALID_CONTEXT_LAYER", f"A study-area {role} layer with compatible type/units is required", 422)
        contexts[role] = layer.id

    if theme in {"forest", "agriculture"}:
        register("landcover", payload.landcover_layer_id, {"landcover"}, {"class"})
    if theme == "forest" and payload.independent_validation_layer_id:
        register("forest_loss", payload.independent_validation_layer_id, {"forest_loss", "independent_validation"}, {"class"})
    if theme == "wildfire":
        register("fire_perimeter", payload.burn_perimeter_layer_id, {"fire_perimeter"})
        register("optical_burn", payload.optical_burn_layer_id, {"optical_burn"}, {"class"})
    if theme == "agriculture" and payload.rainfall_layer_id:
        register("rainfall", payload.rainfall_layer_id, {"rainfall"})
    if theme == "glacier":
        register("glacier_extent", payload.glacier_layer_id, {"glacier_extent"})
    if theme == "deformation":
        for index, identifier in enumerate(payload.phase_correction_layer_ids):
            register(f"phase_correction:{index}", identifier, {"phase_correction"}, {"rad", "radians", "radian"})
    parameters = payload.model_dump(mode="json")
    parameters["context_layers"] = contexts
    parameters["_study_aoi"] = aoi
    parameters["_study_boundary"] = boundary
    return location, scenes, parameters