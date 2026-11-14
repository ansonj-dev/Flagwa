from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.common import location_dict, ok, required
from app.database.session import get_db
from app.models import AnalysisJob, AnalysisResult, CaseStudy, Location, SatelliteScene

router = APIRouter(tags=["Locations and case studies"])


@router.get("/locations")
def locations(request: Request, limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0), db: Session = Depends(get_db)):
    records = db.scalars(select(Location).order_by(Location.slug).offset(offset).limit(limit)).all()
    return ok(request, [location_dict(item) for item in records], limit=limit, offset=offset)


@router.get("/locations/{slug}")
def location(slug: str, request: Request, db: Session = Depends(get_db)):
    return ok(request, location_dict(required(db.scalar(select(Location).where(Location.slug == slug)), "LOCATION_NOT_FOUND", "Location was not found")))


@router.get("/locations/{slug}/availability")
def availability(slug: str, request: Request, db: Session = Depends(get_db)):
    record = required(db.scalar(select(Location).where(Location.slug == slug)), "LOCATION_NOT_FOUND", "Location was not found")
    count = 0
    if record.geometry is not None:
        count = db.scalar(select(func.count()).select_from(SatelliteScene).where(func.ST_Intersects(SatelliteScene.footprint, record.geometry)))
    results = db.scalar(select(func.count()).select_from(AnalysisResult).join(AnalysisJob).where(AnalysisJob.location_id == record.id, AnalysisJob.status == "COMPLETED"))
    return ok(request, {"location": slug, "known_catalogue_scenes": count, "completed_results": results,
                        "availability_status": "catalogue_records_present" if count else "not_verified",
                        "operational_claim": False, "note": "Cached scene counts do not establish a compatible pair or a scientifically validated result"})


def case_dict(record):
    return {key: getattr(record, key) for key in ["id", "slug", "location_id", "title", "scientific_question", "vulnerability_context", "data_status", "priority", "description"]}


@router.get("/case-studies")
def case_studies(request: Request, db: Session = Depends(get_db)):
    return ok(request, [case_dict(record) for record in db.scalars(select(CaseStudy).order_by(CaseStudy.priority, CaseStudy.slug)).all()])


@router.get("/case-studies/{slug}")
def case_study(slug: str, request: Request, db: Session = Depends(get_db)):
    return ok(request, case_dict(required(db.scalar(select(CaseStudy).where(CaseStudy.slug == slug)))))