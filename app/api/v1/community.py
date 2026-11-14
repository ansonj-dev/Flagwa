import json
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from geoalchemy2.shape import to_shape
from shapely.geometry import mapping
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.common import ok, required
from app.api.v1.results import get_result
from app.core.exceptions import FlagwaError
from app.core.security import expensive_request
from app.database.session import get_db
from app.models import AnalysisJob, ContextLayer, Location
from app.services.context.exposure import raster_exposure, vector_exposure
from app.services.storage import get_storage
from app.services.nisar.scene_metadata import public_metadata

router = APIRouter(tags=["Community context"])


def context_layers(db, slug, layer_type):
    location = required(db.scalar(select(Location).where(Location.slug == slug)), "LOCATION_NOT_FOUND", "Location was not found")
    records = db.scalars(select(ContextLayer).where(ContextLayer.location_id == location.id, ContextLayer.layer_type == layer_type)).all()
    if not records:
        raise FlagwaError("CONTEXT_NOT_AVAILABLE", f"No registered {layer_type} dataset for this study area; import a licensed, versioned source", 424)
    return location, records


def community_endpoint(layer_type):
    def layer_metadata(location_slug: str, request: Request, db: Session = Depends(get_db)):
        _, records = context_layers(db, location_slug, layer_type)
        return ok(request, [{"id": layer.id, "layer_type": layer.layer_type, "source": layer.source,
                             "version": layer.version, "provenance": public_metadata(layer.metadata_json)} for layer in records])
    return layer_metadata


for layer_type in ["population", "settlements", "infrastructure", "landcover", "hydrology", "permanent_water", "rainfall", "boundaries"]:
    router.add_api_route(f"/community/{{location_slug}}/{layer_type}", community_endpoint(layer_type), methods=["GET"], operation_id=f"community_{layer_type}")


@router.get("/community/{location_slug}/exposure", dependencies=[Depends(expensive_request)])
def exposure(location_slug: str, result_id: UUID, request: Request, distance_m: float = Query(0, ge=0, le=5000), agriculture_class: int | None = Query(None, ge=0, le=65535), db: Session = Depends(get_db)):
    location = required(db.scalar(select(Location).where(Location.slug == location_slug)), "LOCATION_NOT_FOUND", "Location was not found")
    result = get_result(db, result_id)
    if result.metadata_json.get("geometry_semantics") == "measurement_coverage_not_impact_area":
        raise FlagwaError("EXPOSURE_NOT_APPLICABLE", "Continuous measurement coverage is not a detected change or impact area", 422)
    job = db.get(AnalysisJob, result.analysis_job_id)
    if job.location_id != location.id:
        raise FlagwaError("RESULT_LOCATION_MISMATCH", "Result does not belong to this location", 422)
    geometry = mapping(to_shape(result.output_geometry))
    layers = db.scalars(select(ContextLayer).where(ContextLayer.location_id == location.id)).all()
    if not layers:
        raise FlagwaError("CONTEXT_NOT_AVAILABLE", "No context data have been registered for exposure analysis", 424)
    estimates = []
    for layer in layers:
        if layer.layer_type not in {"population", "settlements", "infrastructure", "hydrology", "landcover"}:
            continue
        path = get_storage().get_file(layer.file_path)
        if layer.layer_type == "population":
            estimate = raster_exposure(path, geometry, layer.metadata_json["units"])
        elif path.suffix.lower() in {".json", ".geojson"}:
            estimate = vector_exposure(json.loads(path.read_text()), geometry, distance_m)
        elif layer.layer_type == "landcover":
            estimate = raster_exposure(path, geometry, "class", [agriculture_class]) if agriculture_class is not None else {"status": "class_selection_required", "note": "Supply agriculture_class using the dataset's reviewed legend"}
        else:
            estimate = {"status": "unsupported_context_format"}
        estimates.append({"context_layer_id": layer.id, "layer_type": layer.layer_type, "source": layer.source,
                          "version": layer.version, "provenance": public_metadata(layer.metadata_json), "exposure": estimate})
    if not estimates:
        raise FlagwaError("EXPOSURE_DATA_NOT_AVAILABLE", "No population, settlement, infrastructure, land-cover or hydrology layers are registered; absence is not zero exposure", 424)
    available_types = {entry["layer_type"] for entry in estimates}
    return ok(request, {"analysis_id": str(result_id), "validation_status": result.validation_status, "estimates": estimates,
                        "synthetic": bool(result.metadata_json.get("synthetic") or any(layer.metadata_json.get("is_synthetic") for layer in layers if layer.layer_type in available_types)),
                        "unavailable_layer_types": sorted({"population", "settlements", "infrastructure", "landcover", "hydrology"} - available_types),
                        "limitations": ["Candidate geographic exposure is not a verified impact or affected-person count"]})