from datetime import datetime, timezone

from fastapi.encoders import jsonable_encoder
from geoalchemy2.shape import to_shape
from shapely.geometry import mapping

from app.core.exceptions import FlagwaError
from app.services.nisar.scene_metadata import public_metadata


def ok(request, data, message="Request completed", **extra):
    return {"success": True, "data": jsonable_encoder(data), "message": message,
            "meta": {"request_id": request.state.request_id, "timestamp": datetime.now(timezone.utc).isoformat(), **extra}}


def required(value, code="RECORD_NOT_FOUND", message="Requested record was not found"):
    if value is None:
        raise FlagwaError(code, message, 404)
    return value


def location_dict(location):
    return {"id": location.id, "name": location.name, "slug": location.slug, "country": location.country,
            "continent": location.continent, "hazard_type": location.hazard_type, "description": location.description,
            "is_active": location.is_active, "geometry": mapping(to_shape(location.geometry)) if location.geometry is not None else None}


def job_dict(job):
    return {key: getattr(job, key) for key in ["id", "location_id", "job_type", "status", "progress", "input_scenes", "parameters",
                                              "created_at", "started_at", "heartbeat_at", "completed_at", "error_message"]}


def result_dict(result):
    return {"id": result.id, "analysis_job_id": result.analysis_job_id, "result_type": result.result_type,
            "statistics": result.statistics, "validation_status": result.validation_status,
            "uncertainty_notes": result.uncertainty_notes,
            "metadata": public_metadata({key: value for key, value in result.metadata_json.items() if key != "artifacts"})}