from datetime import timedelta
from pathlib import Path
from time import time
import math

from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.exceptions import FlagwaError
from app.models import AnalysisJob, SatelliteScene
from app.models.entities import utcnow
from app.services.jobs import transition


def reconcile_jobs(session, redis):
    settings = get_settings()
    cutoff = utcnow() - timedelta(seconds=settings.stale_job_seconds)
    candidates = session.scalars(select(AnalysisJob).where(
        AnalysisJob.status.in_(["RUNNING", "VALIDATING"]),
        func.coalesce(AnalysisJob.heartbeat_at, AnalysisJob.started_at, AnalysisJob.created_at) < cutoff,
    ).with_for_update(skip_locked=True).limit(100)).all()
    recovered = []

    def abandon(job, message):
        transition(job, "FAILED")
        job.error_message = message
        if job.job_type == "download" and job.input_scenes:
            scene = session.scalar(select(SatelliteScene).where(SatelliteScene.scene_id == job.input_scenes[0]))
            if scene and scene.download_status in {"QUEUED", "DOWNLOADING"}:
                scene.download_status = "COMPLETED" if scene.file_path else "FAILED"
        recovered.append(job.id)

    for job in candidates:
        if redis.exists(f"flagwa:job-lock:{job.id}"):
            continue
        abandon(job, "Worker lease expired without a heartbeat; review inputs and use the explicit retry endpoint")
    session.flush()
    active = session.scalar(select(func.count()).select_from(AnalysisJob).where(AnalysisJob.status.in_(["RUNNING", "VALIDATING"])))
    if not active and not redis.llen("celery"):
        deadline = utcnow() - timedelta(seconds=settings.queued_job_timeout_seconds)
        queued = session.scalars(select(AnalysisJob).where(AnalysisJob.status == "QUEUED", AnalysisJob.created_at < deadline)
                                .with_for_update(skip_locked=True).limit(100)).all()
        for job in queued:
            if not redis.exists(f"flagwa:job-lock:{job.id}"):
                abandon(job, "Queued execution expired with no broker backlog or active worker lease; use explicit retry after reviewing service health")
    session.commit()
    return {"reconciled_job_ids": recovered, "action": "failed_safely_not_silently_reexecuted"}


def cleanup_partials(session, root, older_hours=24, apply=False):
    if not math.isfinite(older_hours) or older_hours < 1:
        raise FlagwaError("CLEANUP_AGE_INVALID", "Partial-file cleanup age must be at least one hour", 422)
    active = session.scalar(select(func.count()).select_from(AnalysisJob).where(AnalysisJob.status.in_(["QUEUED", "RUNNING", "VALIDATING"])))
    if active:
        raise FlagwaError("CLEANUP_JOBS_ACTIVE", "Cleanup is refused while any job may use staging files", 409)
    root = Path(root).resolve()
    cutoff = time() - older_hours * 3600
    files = []
    for path in root.rglob("*.partial"):
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root) or path.stat().st_mtime >= cutoff:
            continue
        files.append(str(path.relative_to(root)))
        if apply:
            path.unlink(missing_ok=True)
    return {"dry_run": not apply, "partial_files": files, "count": len(files), "protected": "Complete raw, processed, context and export files are never selected"}