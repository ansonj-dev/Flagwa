from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.common import job_dict, ok, required
from app.api.v1.catalog import get_scene, pair_report
from app.core.exceptions import FlagwaError
from app.core.security import expensive_request, require_admin
from app.database.session import get_db
from app.models import AnalysisJob, ContextLayer, Location, SatelliteScene
from app.models.entities import new_id
from app.schemas.analysis import AnalysisRequest
from app.schemas.catalog import DownloadRequest
from app.schemas.advanced import AgricultureRequest, DeformationRequest, ForestRequest, GlacierRequest, WildfireRequest
from app.services.analysis_submission import prepare_advanced
from app.services.jobs import transition
from app.services.processing.capabilities import CAPABILITIES, require_implementation
from app.workers.tasks import execute_job
from app.services.study_areas import study_context

router = APIRouter(tags=["Acquisition and analysis jobs"])


def enqueue(db, job):
    db.add(job)
    db.commit()
    try:
        execute_job.apply_async(args=[job.id], task_id=job.id)
    except Exception:
        db.refresh(job)
        if job.status == "QUEUED":
            transition(job, "FAILED")
            job.error_message = "Job could not be submitted to Redis"
            if job.job_type == "download":
                get_scene(db, job.input_scenes[0]).download_status = "FAILED"
            db.commit()
        raise FlagwaError("JOB_QUEUE_UNAVAILABLE", "Job submission failed; verify Redis and worker configuration", 503) from None
    return job


@router.post("/scenes/{scene_id}/download", status_code=202, dependencies=[Depends(require_admin), Depends(expensive_request)])
def download(scene_id: str, request: Request, payload: DownloadRequest = DownloadRequest(), db: Session = Depends(get_db)):
    scene = required(db.scalar(select(SatelliteScene).where(SatelliteScene.scene_id == scene_id).with_for_update()), "SCENE_NOT_FOUND", "Scene must first be discovered through the catalogue")
    if scene.download_status in {"QUEUED", "DOWNLOADING", "COMPLETED"} and not (scene.download_status == "COMPLETED" and payload.replace_existing):
        existing = db.scalar(select(AnalysisJob).where(AnalysisJob.job_type == "download", AnalysisJob.input_scenes.contains([scene.scene_id])).order_by(AnalysisJob.created_at.desc()))
        if existing:
            if existing.parameters.get("mode", "full") != payload.mode:
                raise FlagwaError("DOWNLOAD_MODE_CONFLICT", "A different acquisition mode already exists; operator review is required", 409)
            if payload.mode == "aoi_subset" and any(existing.parameters.get(key) != getattr(payload, key) for key in ["location_slug", "frequency_group", "polarization"]):
                raise FlagwaError("DOWNLOAD_SUBSET_CONFLICT", "A different subset already exists for this scene; operator review is required", 409)
            if payload.mode == "aoi_subset" and sorted(existing.parameters.get("additional_polarizations", [])) != sorted(payload.additional_polarizations):
                raise FlagwaError("DOWNLOAD_SUBSET_CONFLICT", "Different covariance layers require explicit replace_existing=true after review", 409)
            return ok(request, job_dict(existing), "Existing download returned")
    parameters = payload.model_dump(mode="json")
    if payload.mode == "aoi_subset":
        location = required(db.scalar(select(Location).where(Location.slug == payload.location_slug)), "LOCATION_NOT_FOUND", "Location was not found")
        required(location.geometry, "AOI_NOT_CONFIGURED", "Study boundary is required for selective acquisition")
        parameters["_study_aoi"], parameters["_study_boundary"] = study_context(db, location)
    scene.download_status = "QUEUED"
    job = AnalysisJob(id=new_id(), job_type="download", status="QUEUED", input_scenes=[scene.scene_id], parameters=parameters)
    enqueue(db, job)
    return ok(request, job_dict(job), "Download queued")


@router.get("/scenes/{scene_id}/download-status")
def download_status(scene_id: str, request: Request, db: Session = Depends(get_db)):
    scene = get_scene(db, scene_id)
    job = db.scalar(select(AnalysisJob).where(AnalysisJob.job_type == "download", AnalysisJob.input_scenes.contains([scene.scene_id])).order_by(AnalysisJob.created_at.desc()))
    return ok(request, {"scene_id": scene_id, "download_status": scene.download_status, "job": job_dict(job) if job else None})


def analysis_endpoint(theme):
    def create_analysis(payload, request: Request, db: Session = Depends(get_db)):
        require_implementation(theme)
        if theme != "flood":
            location, scenes, parameters = prepare_advanced(db, theme, payload)
            job = AnalysisJob(id=new_id(), location_id=location.id, job_type=theme, status="QUEUED",
                              input_scenes=[scene.scene_id for scene in scenes], parameters=parameters)
            enqueue(db, job)
            return ok(request, job_dict(job), "Experimental analysis queued; independent scientific validation remains pending")
        location, before, after, report = pair_report(db, payload)
        if not report["compatible"]:
            raise FlagwaError("INCOMPATIBLE_SCENES", "; ".join(report["blockers"]), 422)
        if before.product_type != CAPABILITIES[theme]["product"]:
            raise FlagwaError("WRONG_PRODUCT_TYPE", f"This analysis requires {CAPABILITIES[theme]['product']}", 422)
        if any(scene.download_status != "COMPLETED" or not scene.file_path for scene in [before, after]):
            raise FlagwaError("SCENE_NOT_DOWNLOADED", "Download and inspect both inputs before creating analysis", 409)
        if payload.parameters is None or payload.permanent_water_layer_id is None:
            raise FlagwaError("FLOOD_CONFIGURATION_REQUIRED", "Provide thresholds, quality mask rules and a registered permanent-water layer", 422)
        water = db.get(ContextLayer, payload.permanent_water_layer_id)
        if not water or water.layer_type != "permanent_water" or water.location_id != location.id:
            raise FlagwaError("PERMANENT_WATER_REQUIRED", "Permanent-water context must belong to this study area", 422)
        if payload.slope_layer_id:
            slope = db.get(ContextLayer, payload.slope_layer_id)
            if not slope or slope.location_id != location.id or slope.layer_type != "slope" or slope.metadata_json.get("units") != "degrees":
                raise FlagwaError("INVALID_SLOPE_LAYER", "Slope context must be a study-area raster in degrees", 422)
        aoi, boundary = study_context(db, location)
        job = AnalysisJob(id=new_id(), location_id=location.id, job_type=theme, status="QUEUED",
                  input_scenes=[before.scene_id, after.scene_id], parameters={**payload.model_dump(mode="json"), "_study_aoi": aoi, "_study_boundary": boundary})
        enqueue(db, job)
        return ok(request, job_dict(job), "Analysis queued; outputs will remain pending scientific validation")
    create_analysis.__annotations__["payload"] = {
        "flood": AnalysisRequest, "forest": ForestRequest, "wildfire": WildfireRequest,
        "agriculture": AgricultureRequest, "glacier": GlacierRequest, "deformation": DeformationRequest,
    }[theme]
    return create_analysis


for theme in CAPABILITIES:
    router.add_api_route(f"/analysis/{theme}", analysis_endpoint(theme), methods=["POST"], status_code=202,
                         dependencies=[Depends(require_admin), Depends(expensive_request)], operation_id=f"create_{theme}_analysis")


@router.get("/jobs")
def jobs(request: Request, limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0), db: Session = Depends(get_db)):
    records = db.scalars(select(AnalysisJob).order_by(AnalysisJob.created_at.desc()).offset(offset).limit(limit)).all()
    return ok(request, [job_dict(job) for job in records], limit=limit, offset=offset)


@router.get("/jobs/{job_id}")
@router.get("/jobs/{job_id}/status")
def job_status(job_id: UUID, request: Request, db: Session = Depends(get_db)):
    return ok(request, job_dict(required(db.get(AnalysisJob, str(job_id)), "JOB_NOT_FOUND", "Requested job was not found")))


@router.post("/jobs/{job_id}/cancel", dependencies=[Depends(require_admin)])
def cancel_job(job_id: UUID, request: Request, db: Session = Depends(get_db)):
    job = required(db.scalar(select(AnalysisJob).where(AnalysisJob.id == str(job_id)).with_for_update()), "JOB_NOT_FOUND", "Requested job was not found")
    if job.status not in {"COMPLETED", "FAILED", "CANCELLED"}:
        transition(job, "CANCELLED")
        if job.job_type == "download":
            scene = get_scene(db, job.input_scenes[0])
            scene.download_status = "COMPLETED" if scene.file_path else "CANCELLED"
        db.commit()
        try:
            execute_job.app.control.revoke(job.id, terminate=False)
        except Exception:
            pass
    return ok(request, job_dict(job), "Cancellation is cooperative; completed and failed jobs are unchanged")


@router.post("/jobs/{job_id}/retry", status_code=202, dependencies=[Depends(require_admin), Depends(expensive_request)])
def retry_job(job_id: UUID, request: Request, db: Session = Depends(get_db)):
    source = required(db.scalar(select(AnalysisJob).where(AnalysisJob.id == str(job_id)).with_for_update()), "JOB_NOT_FOUND", "Requested job was not found")
    if source.status not in {"FAILED", "CANCELLED"} or source.job_type not in {"download", "validation", *CAPABILITIES}:
        raise FlagwaError("JOB_NOT_RETRYABLE", "Only failed or cancelled supported jobs can be retried", 409)
    existing = db.scalar(select(AnalysisJob).where(AnalysisJob.parameters.contains({"_retry_of": source.id}),
                                                  AnalysisJob.status.in_(["QUEUED", "RUNNING", "VALIDATING"])))
    if existing:
        return ok(request, job_dict(existing), "Existing active retry returned")
    if source.job_type == "download":
        scene = get_scene(db, source.input_scenes[0])
        if scene.download_status in {"QUEUED", "DOWNLOADING", "COMPLETED"}:
            raise FlagwaError("SCENE_ALREADY_AVAILABLE_OR_ACTIVE", "Existing acquisition must be reviewed before retrying", 409)
        scene.download_status = "QUEUED"
    job = AnalysisJob(id=new_id(), location_id=source.location_id, job_type=source.job_type, status="QUEUED",
                      input_scenes=list(source.input_scenes), parameters=dict(source.parameters, _retry_of=source.id))
    enqueue(db, job)
    return ok(request, job_dict(job), "New execution queued; the original terminal job record is unchanged")