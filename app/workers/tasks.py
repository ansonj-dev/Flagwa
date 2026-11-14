from tempfile import TemporaryDirectory
from time import monotonic
import json
from pathlib import Path

from geoalchemy2.shape import from_shape, to_shape
from redis import Redis
from shapely.geometry import mapping, shape
from sqlalchemy import select

from app.core.config import get_settings
from app.core.exceptions import FlagwaError
from app.database.session import session_factory
from app.models import AnalysisJob, AnalysisResult, ContextLayer, Location, SatelliteScene
from app.services.catalog import scene_model
from app.services.jobs import transition
from app.services.nisar.compatibility import compatibility
from app.services.nisar.scene_download import download_scene
from app.services.nisar.subset_download import download_subset
from app.services.processing.hdf5_reader import inspect_product
from app.services.processing.pipeline import process_flood
from app.services.processing.advanced_pipeline import process_advanced
from app.services.analysis_submission import prepare_advanced
from app.schemas.advanced import AgricultureRequest, DeformationRequest, ForestRequest, GlacierRequest, WildfireRequest
from app.services.storage import get_storage
from app.workers.celery_app import celery_app
from app.workers.heartbeat import JobHeartbeat
from app.schemas.validation import ValidationRequest
from app.services.validation import assess_validation


def update_progress(job_id, progress):
    with session_factory() as session:
        job = session.scalar(select(AnalysisJob).where(AnalysisJob.id == job_id).with_for_update())
        if job is None or job.status not in {"RUNNING", "VALIDATING"}:
            raise FlagwaError("JOB_STOPPED", "Job is no longer running; publication is forbidden", 409)
        job.progress = max(job.progress, progress)
        from app.models.entities import utcnow
        job.heartbeat_at = utcnow()
        session.commit()


@celery_app.task(bind=True, name="flagwa.execute_job", max_retries=2)
def execute_job(self, job_id):
    settings = get_settings()
    settings.local_storage_path.mkdir(parents=True, exist_ok=True)
    redis = Redis.from_url(settings.redis_url.get_secret_value(), socket_timeout=5, socket_connect_timeout=5)
    lock = redis.lock(f"flagwa:job-lock:{job_id}", timeout=settings.job_lease_seconds, blocking=False, thread_local=False)
    heartbeat = JobHeartbeat(job_id, lock)
    acquired = False
    try:
        acquired = lock.acquire()
        if not acquired:
            raise self.retry(countdown=30)
        with session_factory() as session:
            job = session.scalar(select(AnalysisJob).where(AnalysisJob.id == job_id).with_for_update())
            if not job or job.status in {"COMPLETED", "FAILED", "CANCELLED"}:
                return {"job_id": job_id, "status": job.status if job else "missing"}
            if job.status != "QUEUED":
                raise FlagwaError("JOB_RECOVERY_REQUIRED", "Interrupted job requires operator review before rerun", 409)
            transition(job, "RUNNING", 1)
            session.commit()
            heartbeat.start()

            def progress(value):
                heartbeat.check()
                update_progress(job_id, value)
            if job.job_type == "download":
                scene = session.scalar(select(SatelliteScene).where(SatelliteScene.scene_id == job.input_scenes[0]))
                if scene is None:
                    raise FlagwaError("SCENE_NOT_FOUND", "Input scene is missing", 404)
                scene.download_status = "DOWNLOADING"
                session.commit()
                last_progress = [0.0, -1]

                def transfer_progress(value):
                    now = monotonic()
                    if value != last_progress[1] or now - last_progress[0] > 2:
                        progress(value)
                        last_progress[:] = [now, value]

                if job.parameters.get("mode") == "aoi_subset":
                    location = session.scalar(select(Location).where(Location.slug == job.parameters["location_slug"]))
                    if not location or location.geometry is None:
                        raise FlagwaError("AOI_NOT_CONFIGURED", "A configured study boundary is required for selective acquisition", 422)
                    key, details = download_subset(scene, job.parameters.get("_study_aoi") or mapping(to_shape(location.geometry)), job.parameters, transfer_progress)
                else:
                    key, details = download_scene(scene, transfer_progress)
                inspection = inspect_product(get_storage().get_file(key))
                identification = inspection["identification"]
                if identification.get("productType") and identification["productType"] != scene.product_type:
                    raise FlagwaError("PRODUCT_IDENTITY_MISMATCH", "Downloaded product type differs from catalogue", 422)
                if identification.get("granuleId") and identification["granuleId"] != scene.scene_id:
                    raise FlagwaError("PRODUCT_IDENTITY_MISMATCH", "Downloaded granule identifier differs from catalogue", 422)
                orbit = dict(scene.orbit_information)
                if identification.get("lookDirection"):
                    orbit["lookDirection"] = str(identification["lookDirection"]).upper()
                with session_factory() as finishing:
                    current = finishing.scalar(select(AnalysisJob).where(AnalysisJob.id == job_id).with_for_update())
                    if current.status not in {"RUNNING", "VALIDATING"}:
                        return {"job_id": job_id, "status": current.status}
                    heartbeat.check()
                    stored_scene = finishing.scalar(select(SatelliteScene).where(SatelliteScene.id == scene.id).with_for_update())
                    stored_scene.orbit_information = orbit
                    stored_scene.file_path = key
                    stored_scene.download_status = "COMPLETED"
                    current.parameters = dict(current.parameters, _acquisition_manifest=details)
                    stored_scene.metadata_json = dict(stored_scene.metadata_json, download=details, hdf5=inspection)
                    transition(current, "VALIDATING", 95)
                    transition(current, "COMPLETED", 100)
                    finishing.commit()
            elif job.job_type == "validation":
                payload = ValidationRequest.model_validate({key: value for key, value in job.parameters.items() if key != "result_id" and not key.startswith("_")})
                target = session.get(AnalysisResult, job.parameters["result_id"])
                if target is None:
                    raise FlagwaError("RESULT_NOT_FOUND", "Validation target was not found", 404)
                record = assess_validation(session, target, payload, job_id, progress)
                with session_factory() as finishing:
                    current = finishing.scalar(select(AnalysisJob).where(AnalysisJob.id == job_id).with_for_update())
                    if current.status not in {"RUNNING", "VALIDATING"}:
                        return {"job_id": job_id, "status": current.status}
                    heartbeat.check()
                    reviewed = finishing.scalar(select(AnalysisResult).where(AnalysisResult.id == target.id).with_for_update())
                    metadata = dict(reviewed.metadata_json)
                    history = list(metadata.get("validation_history", []))
                    if len(history) >= 100:
                        raise FlagwaError("VALIDATION_HISTORY_LIMIT", "Archive existing review history before adding more assessments", 409)
                    history.append(record)
                    if payload.approve:
                        reviewed.validation_status = "validated" if record["approved"] else "pending_validation"
                    metadata.update(validation_history=history, result_status=reviewed.validation_status)
                    metadata["validation_sources"] = list(metadata.get("validation_sources", [])) + [{
                        "reference_layer_id": record["reference_layer_id"], "assessment_id": record["id"],
                        "reference_version": record["reference_version"], "reference_sha256": record["reference_sha256"], "approved": record["approved"]}]
                    summary = {"analysis_id": reviewed.id, "result_type": reviewed.result_type, "statistics": reviewed.statistics,
                               "source_scenes": metadata.get("source_scenes", []), "validation_status": reviewed.validation_status,
                               "validation_history": history, "uncertainty_notes": reviewed.uncertainty_notes,
                               "generation_note": "Raster pixels and generation-time tags remain immutable; this versioned review record supplies current validation status"}
                    with TemporaryDirectory(dir=settings.local_storage_path, prefix="review-") as directory:
                        path = Path(directory) / "summary.json"
                        path.write_text(json.dumps(summary, indent=2))
                        key = f"processed/{reviewed.id}/validation/{job_id}/summary.json"
                        get_storage().put_file(path, key)
                    metadata["artifacts"] = dict(metadata.get("artifacts", {}), summary=key)
                    reviewed.metadata_json = metadata
                    transition(current, "VALIDATING", 95)
                    transition(current, "COMPLETED", 100)
                    finishing.commit()
            else:
                if job.job_type not in {"flood", "forest", "agriculture", "wildfire", "glacier", "deformation"}:
                    raise FlagwaError("SCIENTIFIC_MODULE_NOT_IMPLEMENTED", "No scientific processor is registered for this job type", 501)
                location = session.get(Location, job.location_id)
                scenes = [session.scalar(select(SatelliteScene).where(SatelliteScene.scene_id == identifier)) for identifier in job.input_scenes]
                if any(scene is None or scene.download_status != "COMPLETED" or not scene.file_path for scene in scenes):
                    raise FlagwaError("SCENE_NOT_DOWNLOADED", "Both scenes must have completed authorized downloads", 409)
                aoi = job.parameters.get("_study_aoi") or mapping(to_shape(location.geometry))
                normalized = [scene_model(scene) for scene in scenes]
                if job.job_type == "flood":
                    report = compatibility(*normalized, aoi, job.parameters["polarization"], job.parameters["frequency_group"])
                    if not report["compatible"]:
                        raise FlagwaError("INCOMPATIBLE_SCENES", "; ".join(report["blockers"]), 422)
                water = session.get(ContextLayer, job.parameters["permanent_water_layer_id"]) if job.job_type == "flood" else None
                slope = session.get(ContextLayer, job.parameters.get("slope_layer_id")) if job.parameters.get("slope_layer_id") else None
                if job.job_type == "flood" and (not water or water.location_id != location.id or water.layer_type != "permanent_water"):
                    raise FlagwaError("PERMANENT_WATER_REQUIRED", "A registered study-area permanent-water layer is required", 422)
                if slope and (slope.location_id != location.id or slope.layer_type != "slope" or slope.metadata_json.get("units") != "degrees"):
                    raise FlagwaError("INVALID_SLOPE_LAYER", "Slope context must be a study-area slope raster in degrees", 422)
                storage = get_storage()
                with TemporaryDirectory(prefix="flagwa-", dir=settings.local_storage_path) as temporary:
                    context_provenance = {}
                    if job.job_type == "flood":
                        processing_request = dict(job.parameters, _synthetic_context=bool(water.metadata_json.get("is_synthetic") or (slope and slope.metadata_json.get("is_synthetic"))))
                        output = process_flood(storage.get_file(scenes[0].file_path), storage.get_file(scenes[1].file_path),
                                           storage.get_file(water.file_path), aoi, processing_request, normalized, job_id,
                                           temporary, progress,
                                           storage.get_file(slope.file_path) if slope else None)
                        context_provenance = {"permanent_water": water.metadata_json, "slope": slope.metadata_json if slope else None}
                    else:
                        schema = {"forest": ForestRequest, "wildfire": WildfireRequest, "agriculture": AgricultureRequest,
                                  "glacier": GlacierRequest, "deformation": DeformationRequest}[job.job_type]
                        payload = schema.model_validate({key: value for key, value in job.parameters.items() if key != "context_layers" and not key.startswith("_")})
                        _, _, checked = prepare_advanced(session, job.job_type, payload, aoi, job.parameters.get("_study_boundary"))
                        context_paths = {}
                        for role, identifier in checked["context_layers"].items():
                            layer = session.get(ContextLayer, identifier)
                            context_paths[role] = storage.get_file(layer.file_path)
                            context_provenance[role] = layer.metadata_json
                        checked["_synthetic_context"] = any(provenance.get("is_synthetic") for provenance in context_provenance.values())
                        output = process_advanced(job.job_type, [storage.get_file(scene.file_path) for scene in scenes], context_paths,
                                                 aoi, checked, normalized, job_id, temporary, progress)
                    artifacts = {}
                    for name, path in output["files"].items():
                        progress(92)
                        key = f"processed/{job_id}/{path.name}"
                        storage.put_file(path, key)
                        artifacts[name] = key
                    with session_factory() as finishing:
                        current = finishing.scalar(select(AnalysisJob).where(AnalysisJob.id == job_id).with_for_update())
                        if current.status not in {"RUNNING", "VALIDATING"}:
                            return {"job_id": job_id, "status": current.status}
                        heartbeat.check()
                        transition(current, "VALIDATING", 95)
                        result = AnalysisResult(id=job_id, analysis_job_id=job_id, result_type=output["metadata"]["analysis_type"],
                                                output_path=artifacts["geotiff"], preview_path=artifacts["preview"],
                                                output_geometry=from_shape(shape(output["geometry"]), srid=4326),
                                                statistics=output["statistics"], validation_status="pending_validation",
                                                uncertainty_notes=output["metadata"]["uncertainty_notes"],
                                                metadata_json=dict(output["metadata"], artifacts=artifacts,
                                                                   context_provenance=context_provenance))
                        finishing.add(result)
                        transition(current, "COMPLETED", 100)
                        finishing.commit()
        return {"job_id": job_id, "status": "COMPLETED"}
    except Exception as error:
        from celery.exceptions import Retry

        if isinstance(error, Retry):
            raise
        safe_message = error.message if isinstance(error, FlagwaError) else "Processing failed; inspect internal service health and input products"
        retryable = isinstance(error, FlagwaError) and error.code in {"DOWNLOAD_INTERRUPTED", "ASF_RESOLVE_FAILED", "DOWNLOAD_INCOMPLETE", "BHOONIDHI_DOWNLOAD_FAILED"}
        final_status = "FAILED"
        with session_factory() as session:
            job = session.scalar(select(AnalysisJob).where(AnalysisJob.id == job_id).with_for_update())
            if job and job.status not in {"CANCELLED", "COMPLETED", "FAILED"}:
                if retryable and self.request.retries < self.max_retries and job.status == "RUNNING":
                    transition(job, "QUEUED", 0)
                else:
                    transition(job, "FAILED")
                job.error_message = safe_message
                if job.job_type == "download":
                    scene = session.scalar(select(SatelliteScene).where(SatelliteScene.scene_id == job.input_scenes[0]))
                    if scene:
                        scene.download_status = "QUEUED" if job.status == "QUEUED" else "COMPLETED" if scene.file_path else "FAILED"
                session.commit()
            if job:
                final_status = job.status
        if retryable and self.request.retries < self.max_retries:
            raise self.retry(exc=FlagwaError("RETRYABLE_TRANSFER", safe_message, 502), countdown=30 * (self.request.retries + 1))
        return {"job_id": job_id, "status": final_status, "error": safe_message}
    finally:
        heartbeat.close()
        if acquired:
            try:
                lock.release()
            except Exception:
                pass
        redis.close()


@celery_app.task(name="flagwa.reconcile_jobs")
def reconcile_expired_jobs():
    from app.services.maintenance import reconcile_jobs

    with Redis.from_url(get_settings().redis_url.get_secret_value(), socket_timeout=5) as client:
        with session_factory() as session:
            return reconcile_jobs(session, client)