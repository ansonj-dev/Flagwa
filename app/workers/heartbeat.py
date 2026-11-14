from threading import Event, Thread

from sqlalchemy import select

from app.core.config import get_settings
from app.core.exceptions import FlagwaError
from app.database.session import session_factory
from app.models import AnalysisJob
from app.models.entities import utcnow


class JobHeartbeat:
    def __init__(self, job_id, lock):
        self.job_id, self.lock = job_id, lock
        self.stop, self.lost = Event(), Event()
        self.thread = None

    def pulse(self):
        self.lock.extend(get_settings().job_lease_seconds, replace_ttl=True)
        with session_factory() as session:
            job = session.scalar(select(AnalysisJob).where(AnalysisJob.id == self.job_id).with_for_update())
            if job is None or job.status not in {"RUNNING", "VALIDATING"}:
                self.lost.set()
                return False
            job.heartbeat_at = utcnow()
            session.commit()
        return True

    def _run(self):
        while not self.stop.wait(get_settings().job_heartbeat_seconds):
            try:
                if not self.pulse():
                    return
            except Exception:
                self.lost.set()
                return

    def start(self):
        self.thread = Thread(target=self._run, name=f"flagwa-heartbeat-{self.job_id}", daemon=True)
        self.thread.start()

    def check(self):
        if self.lost.is_set() or not self.lock.owned():
            raise FlagwaError("JOB_LEASE_LOST", "Worker no longer owns the execution lease; no result will be published", 409)

    def close(self):
        self.stop.set()
        if self.thread:
            self.thread.join(timeout=6)