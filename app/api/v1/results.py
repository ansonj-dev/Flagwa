from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.common import ok, required, result_dict
from app.core.exceptions import FlagwaError
from app.database.session import get_db
from app.models import AnalysisJob, AnalysisResult
from app.services.nisar.scene_metadata import public_metadata
from app.services.storage import get_storage

router = APIRouter(tags=["Results and exports"])


def get_result(db, result_id):
    return required(db.scalar(select(AnalysisResult).join(AnalysisJob).where(AnalysisResult.id == str(result_id), AnalysisJob.status == "COMPLETED")), "RESULT_NOT_FOUND", "Published result record was not found")


@router.get("/results")
def results(request: Request, limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0), db: Session = Depends(get_db)):
    records = db.scalars(select(AnalysisResult).join(AnalysisJob).where(AnalysisJob.status == "COMPLETED").order_by(AnalysisJob.created_at.desc()).offset(offset).limit(limit)).all()
    return ok(request, [result_dict(record) for record in records], limit=limit, offset=offset)


@router.get("/results/{result_id}")
def result(result_id: UUID, request: Request, db: Session = Depends(get_db)):
    return ok(request, result_dict(get_result(db, result_id)))


@router.get("/results/{result_id}/statistics")
def statistics(result_id: UUID, request: Request, db: Session = Depends(get_db)):
    return ok(request, get_result(db, result_id).statistics)


@router.get("/results/{result_id}/metadata")
def metadata(result_id: UUID, request: Request, db: Session = Depends(get_db)):
    record = get_result(db, result_id)
    return ok(request, public_metadata({key: value for key, value in record.metadata_json.items() if key != "artifacts"}))


def artifact(db, result_id, name, media_type):
    record = get_result(db, result_id)
    key = record.metadata_json.get("artifacts", {}).get(name)
    if not key:
        raise FlagwaError("EXPORT_UNAVAILABLE", "This result has no requested artifact", 404)
    path = get_storage().get_file(key)
    extension = {"geotiff": "tif", "geojson": "geojson", "summary": "json", "preview": "png"}[name]
    return FileResponse(path, media_type=media_type, filename=f"flagwa-{result_id}.{extension}")


@router.get("/results/{result_id}/preview", response_class=FileResponse)
def preview(result_id: UUID, db: Session = Depends(get_db)):
    return artifact(db, result_id, "preview", "image/png")


@router.get("/exports/{result_id}/geotiff", response_class=FileResponse)
def geotiff(result_id: UUID, db: Session = Depends(get_db)):
    return artifact(db, result_id, "geotiff", "image/tiff; application=geotiff; profile=cloud-optimized")


@router.get("/exports/{result_id}/geojson", response_class=FileResponse)
def geojson(result_id: UUID, db: Session = Depends(get_db)):
    return artifact(db, result_id, "geojson", "application/geo+json")


@router.get("/exports/{result_id}/summary", response_class=FileResponse)
def summary(result_id: UUID, db: Session = Depends(get_db)):
    return artifact(db, result_id, "summary", "application/json")