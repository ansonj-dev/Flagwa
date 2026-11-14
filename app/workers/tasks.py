from tempfile import TemporaryDirectory
from time import monotonic

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
from app.services.storage import get_storage
from app.workers.celery_app import celery_app


def update_progress(job_id, progress):
    with session_factory() as session:
        job = session.scalar(select(AnalysisJob).where(AnalysisJob.id == job_id).with_for_update())
        if job is None or job.status == "CANCELLED":
            raise FlagwaError("JOB_CANCELLED", "Job cancelled", 409)
        job.progress = max(job.progress, progress)
        session.commit()


@celery_app.task(bind=True, name="flagwa.execute_job", max_retries=2)
def execute_job(self, job_id):
    settings = get_settings()
    settings.local_storage_path.mkdir(parents=True, exist_ok=True)
    redis = Redis.from_url(settings.redis_url.get_secret_value(), socket_timeout=5, socket_connect_timeout=5)
    lock = redis.lock(f"flagwa:job-lock:{job_id}", timeout=15000, blocking=False)
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
            if job.job_type == "download":
                scene = session.scalar(select(SatelliteScene).where(SatelliteScene.scene_id == job.input_scenes[0]))
                if scene is None:
                    raise FlagwaError("SCENE_NOT_FOUND", "Input scene is missing", 404)
                scene.download_status = "DOWNLOADING"
                session.commit()
                last_progress = [0.0, -1]

                def progress(value):
                    now = monotonic()
                    if value != last_progress[1] or now - last_progress[0] > 2:
                        update_progress(job_id, value)
                        last_progress[:] = [now, value]

                if job.parameters.get("mode") == "aoi_subset":
                    location = session.scalar(select(Location).where(Location.slug == job.parameters["location_slug"]))
                    if not location or location.geometry is None:
                        raise FlagwaError("AOI_NOT_CONFIGURED", "A configured study boundary is required for selective acquisition", 422)
                    key, details = download_subset(scene, mapping(to_shape(location.geometry)), job.parameters, progress)
                else:
                    key, details = download_scene(scene, progress)
                inspection = inspect_product(get_storage().get_file(key))
                identification = inspection["identification"]
                if identification.get("productType") and identification["productType"] != scene.product_type:
                    raise FlagwaError("PRODUCT_IDENTITY_MISMATCH", "Downloaded product type differs from catalogue", 422)
                if identification.get("granuleId") and identification["granuleId"] != scene.scene_id:
                    raise FlagwaError("PRODUCT_IDENTITY_MISMATCH", "Downloaded granule identifier differs from catalogue", 422)
                orbit = dict(scene.orbit_information)
                if identification.get("lookDirection"):
                    orbit["lookDirection"] = str(identification["lookDirection"]).upper()
                scene.orbit_information = orbit
                scene.file_path = key
                scene.download_status = "COMPLETED"
                scene.metadata_json = dict(scene.metadata_json, download=details, hdf5=inspection)
                session.commit()
                with session_factory() as finishing:
                    current = finishing.scalar(select(AnalysisJob).where(AnalysisJob.id == job_id).with_for_update())
                    if current.status == "CANCELLED":
                        return {"job_id": job_id, "status": "CANCELLED"}
                    transition(current, "VALIDATING", 95)
                    transition(current, "COMPLETED", 100)
                    finishing.commit()
            else:
                if job.job_type != "flood":
                    raise FlagwaError("SCIENTIFIC_MODULE_NOT_IMPLEMENTED", "Only potential inundation has an implemented processing pipeline", 501)
                location = session.get(Location, job.location_id)
                scenes = [session.scalar(select(SatelliteScene).where(SatelliteScene.scene_id == identifier)) for identifier in job.input_scenes]
                if any(scene is None or scene.download_status != "COMPLETED" or not scene.file_path for scene in scenes):
                    raise FlagwaError("SCENE_NOT_DOWNLOADED", "Both scenes must have completed authorized downloads", 409)
                aoi = mapping(to_shape(location.geometry))
                normalized = [scene_model(scene) for scene in scenes]
                report = compatibility(*normalized, aoi, job.parameters["polarization"], job.parameters["frequency_group"])
                if not report["compatible"]:
                    raise FlagwaError("INCOMPATIBLE_SCENES", "; ".join(report["blockers"]), 422)
                water = session.get(ContextLayer, job.parameters["permanent_water_layer_id"])
                slope = session.get(ContextLayer, job.parameters.get("slope_layer_id")) if job.parameters.get("slope_layer_id") else None
                if not water or water.location_id != location.id or water.layer_type != "permanent_water":
                    raise FlagwaError("PERMANENT_WATER_REQUIRED", "A registered study-area permanent-water layer is required", 422)
                if slope and (slope.location_id != location.id or slope.layer_type != "slope" or slope.metadata_json.get("units") != "degrees"):
                    raise FlagwaError("INVALID_SLOPE_LAYER", "Slope context must be a study-area slope raster in degrees", 422)
                storage = get_storage()
                with TemporaryDirectory(prefix="flagwa-", dir=settings.local_storage_path) as temporary:
                    output = process_flood(storage.get_file(scenes[0].file_path), storage.get_file(scenes[1].file_path),
                                           storage.get_file(water.file_path), aoi, job.parameters, normalized, job_id,
                                           temporary, lambda value: update_progress(job_id, value),
                                           storage.get_file(slope.file_path) if slope else None)
                    artifacts = {}
                    for name, path in output["files"].items():
                        update_progress(job_id, 92)
                        key = f"processed/{job_id}/{path.name}"
                        storage.put_file(path, key)
                        artifacts[name] = key
                    with session_factory() as finishing:
                        current = finishing.scalar(select(AnalysisJob).where(AnalysisJob.id == job_id).with_for_update())
                        if current.status == "CANCELLED":
                            return {"job_id": job_id, "status": "CANCELLED"}
                        transition(current, "VALIDATING", 95)
                        result = AnalysisResult(id=job_id, analysis_job_id=job_id, result_type="potential_inundation",
                                                output_path=artifacts["geotiff"], preview_path=artifacts["preview"],
                                                output_geometry=from_shape(shape(output["geometry"]), srid=4326),
                                                statistics=output["statistics"], validation_status="pending_validation",
                                                uncertainty_notes=output["metadata"]["uncertainty_notes"],
                                                metadata_json=dict(output["metadata"], artifacts=artifacts,
                                                                   context_provenance={"permanent_water": water.metadata_json,
                                                                                       "slope": slope.metadata_json if slope else None}))
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
                        scene.download_status = "QUEUED" if job.status == "QUEUED" else "FAILED"
                session.commit()
        if retryable and self.request.retries < self.max_retries:
            raise self.retry(exc=FlagwaError("RETRYABLE_TRANSFER", safe_message, 502), countdown=30 * (self.request.retries + 1))
        return {"job_id": job_id, "status": "FAILED", "error": safe_message}
    finally:
        if acquired:
            try:
                lock.release()
            except Exception:
                pass
        redis.close()