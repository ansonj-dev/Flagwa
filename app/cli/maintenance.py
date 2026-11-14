import argparse
import json

from redis import Redis

from app.core.config import get_settings
from app.database.session import session_factory
from app.services.maintenance import cleanup_partials, reconcile_jobs


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Operator-only recovery and conservative partial-file cleanup")
    parser.add_argument("action", choices=["reconcile", "cleanup"])
    parser.add_argument("--older-hours", type=float, default=24)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    settings = get_settings()
    with session_factory() as session:
        if args.action == "reconcile":
            with Redis.from_url(settings.redis_url.get_secret_value(), socket_timeout=5) as client:
                result = reconcile_jobs(session, client)
        else:
            result = cleanup_partials(session, settings.local_storage_path, args.older_hours, args.apply)
    print(json.dumps(result, indent=2))