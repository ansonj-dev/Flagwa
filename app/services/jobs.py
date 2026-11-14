from app.core.exceptions import FlagwaError
from app.models.entities import utcnow

TRANSITIONS = {
    "QUEUED": {"RUNNING", "FAILED", "CANCELLED"},
    "RUNNING": {"VALIDATING", "FAILED", "CANCELLED", "QUEUED"},
    "VALIDATING": {"COMPLETED", "FAILED", "CANCELLED"},
    "COMPLETED": set(), "FAILED": set(), "CANCELLED": set(),
}


def transition(job, status: str, progress: int | None = None):
    if status not in TRANSITIONS.get(job.status, set()):
        raise FlagwaError("INVALID_JOB_TRANSITION", f"Cannot change {job.status} to {status}", 409)
    if progress is not None and not 0 <= progress <= 100:
        raise FlagwaError("INVALID_PROGRESS", "Progress must be between 0 and 100")
    job.status = status
    if progress is not None:
        job.progress = progress
    if status == "RUNNING":
        job.started_at = utcnow()
        job.heartbeat_at = utcnow()
    if status in {"COMPLETED", "FAILED", "CANCELLED"}:
        job.completed_at = utcnow()
    if status == "COMPLETED":
        job.progress = 100