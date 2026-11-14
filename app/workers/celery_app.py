from celery import Celery

from app.core.config import get_settings

settings = get_settings()
celery_app = Celery("flagwa", broker=settings.redis_url.get_secret_value(),
                    backend=settings.redis_url.get_secret_value(), include=["app.workers.tasks"])
celery_app.conf.update(
    task_serializer="json", result_serializer="json", accept_content=["json"],
    task_track_started=True, task_acks_late=True, worker_prefetch_multiplier=1,
    task_soft_time_limit=14400, task_time_limit=14460,
    broker_connection_retry_on_startup=True, broker_connection_max_retries=3,
    broker_transport_options={"visibility_timeout": 15000},
    task_publish_retry=False, broker_connection_timeout=3,
    result_expires=86400, worker_hijack_root_logger=False,
    beat_schedule={"flagwa-reconcile-expired-jobs": {"task": "flagwa.reconcile_jobs", "schedule": 60.0}},
)