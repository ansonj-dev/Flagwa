import json
from pathlib import Path

from geoalchemy2.shape import from_shape, to_shape
from shapely.geometry import mapping, shape
from sqlalchemy import func, or_, select

from app.core.exceptions import FlagwaError
from app.models import AnalysisJob, ContextLayer, Location
from app.models.entities import utcnow
from app.services.context.registry import register_context


def study_context(session, location):
    geometry = mapping(to_shape(location.geometry))
    layer = session.scalar(select(ContextLayer).where(ContextLayer.location_id == location.id,
        ContextLayer.layer_type == "boundaries", ContextLayer.metadata_json.contains({"study_boundary_active": True})))
    provenance = {"status": "draft_or_unreviewed", "description": location.description}
    if layer and layer.metadata_json.get("study_boundary_geometry"):
        if shape(layer.metadata_json["study_boundary_geometry"]).equals(shape(geometry)):
            provenance = {"status": "reviewed", "source_layer_id": layer.id, "source": layer.source, "version": layer.version,
                          "source_url": layer.metadata_json["source_url"], "license": layer.metadata_json["license"],
                          "reviewed_by": layer.metadata_json["reviewed_by"], "reviewed_at": layer.metadata_json["reviewed_at"]}
    return geometry, provenance


def set_study_area(session, path, registration, reviewed_by, feature_id=None):
    if registration.layer_type != "boundaries" or registration.crs not in {"EPSG:4326", "OGC:CRS84"} or len(reviewed_by.strip()) < 3:
        raise FlagwaError("BOUNDARY_REVIEW_REQUIRED", "A reviewed WGS84 boundary registration and operator identity are required", 422)
    location = session.scalar(select(Location).where(Location.slug == registration.location_slug).with_for_update())
    if not location:
        raise FlagwaError("LOCATION_NOT_FOUND", "Location was not found", 404)
    active = session.scalar(select(func.count()).select_from(AnalysisJob).where(
        or_(AnalysisJob.location_id == location.id, AnalysisJob.parameters.contains({"location_slug": location.slug})),
        AnalysisJob.status.in_(["QUEUED", "RUNNING", "VALIDATING"])))
    if active:
        raise FlagwaError("AOI_JOBS_ACTIVE", "Study boundaries cannot be changed while related jobs are active", 409)
    path = Path(path)
    if path.stat().st_size > 64 * 1024 * 1024:
        raise FlagwaError("BOUNDARY_SIZE_LIMIT", "Boundary GeoJSON exceeds the 64 MiB operator limit", 413)
    collection = json.loads(path.read_text())
    features = collection.get("features", [])
    if feature_id is not None:
        features = [feature for feature in features if str(feature.get("id", feature.get("properties", {}).get("shapeID"))) == feature_id]
    if len(features) != 1:
        raise FlagwaError("BOUNDARY_SELECTION_REQUIRED", "Supply one GeoJSON feature or choose an actual --feature-id", 422)
    polygon = shape(features[0]["geometry"])
    west, south, east, north = polygon.bounds if not polygon.is_empty else (0, 0, 0, 0)
    if not polygon.is_valid or polygon.geom_type not in {"Polygon", "MultiPolygon"} or not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise FlagwaError("BOUNDARY_INVALID", "Study boundary must be a valid nonempty WGS84 polygon or multipolygon", 422)
    prior = session.scalars(select(ContextLayer).where(ContextLayer.location_id == location.id,
        ContextLayer.layer_type == "boundaries", ContextLayer.metadata_json.contains({"study_boundary_active": True}))).all()
    for layer in prior:
        layer.metadata_json = dict(layer.metadata_json, study_boundary_active=False)
    layer = register_context(session, path, registration, commit=False)
    layer.metadata_json = dict(layer.metadata_json, study_boundary_active=True, study_boundary_geometry=mapping(polygon),
                               reviewed_by=reviewed_by, reviewed_at=utcnow().isoformat())
    location.geometry = from_shape(polygon, srid=4326)
    location.description = f"Operator-reviewed study boundary from {registration.source}, version {registration.version}; not an observed hazard extent"
    session.commit()
    return layer