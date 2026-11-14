from fastapi import APIRouter, Depends, Request
from geoalchemy2.shape import to_shape
from shapely.geometry import mapping
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.common import ok, required
from app.core.security import expensive_request
from app.database.session import get_db
from app.models import Location, SatelliteScene
from app.schemas.catalog import CatalogSearch, CompatibilityRequest
from app.services.catalog import persist_scene, scene_model
from app.services.nisar.asf_client import ASFClient
from app.services.nisar.bhoonidhi_client import bhoonidhi_client
from app.services.nisar.compatibility import compatibility
from app.services.nisar.scene_metadata import public_metadata

router = APIRouter(tags=["NISAR catalogue"])


def get_scene(db, scene_id):
    return required(db.scalar(select(SatelliteScene).where(SatelliteScene.scene_id == scene_id)), "SCENE_NOT_FOUND", "Requested scene was not found in the local catalogue")


@router.post("/catalog/nisar/search", dependencies=[Depends(expensive_request)])
def search(payload: CatalogSearch, request: Request, db: Session = Depends(get_db)):
    adapter = ASFClient() if payload.provider == "ASF" else bhoonidhi_client()
    scenes, has_more = adapter.search(payload)
    for scene in scenes:
        persist_scene(db, scene)
    db.commit()
    return ok(request, [{**scene.model_dump(mode="json"), "metadata": public_metadata(scene.metadata)} for scene in scenes],
              limit=payload.limit, offset=payload.offset, has_more=has_more,
              pagination="bounded provider search; offset plus limit must remain at most 500")


@router.get("/catalog/nisar/scenes/{scene_id}")
@router.get("/scenes/{scene_id}")
def scene_details(scene_id: str, request: Request, db: Session = Depends(get_db)):
    record = get_scene(db, scene_id)
    scene = scene_model(record)
    return ok(request, {**scene.model_dump(mode="json"), "metadata": public_metadata(scene.metadata), "download_status": record.download_status})


def pair_report(db, payload):
    location = required(db.scalar(select(Location).where(Location.slug == payload.location_slug)), "LOCATION_NOT_FOUND", "Location was not found")
    required(location.geometry, "AOI_NOT_CONFIGURED", "A reviewed or explicitly draft study boundary is required")
    before, after = get_scene(db, payload.before_scene_id), get_scene(db, payload.after_scene_id)
    report = compatibility(scene_model(before), scene_model(after), mapping(to_shape(location.geometry)), payload.polarization, payload.frequency_group)
    return location, before, after, report


@router.post("/catalog/nisar/compatibility-check")
def check_compatibility(payload: CompatibilityRequest, request: Request, db: Session = Depends(get_db)):
    return ok(request, pair_report(db, payload)[3])