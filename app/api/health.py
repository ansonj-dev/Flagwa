from fastapi import APIRouter, Request
from alembic.config import Config
from alembic.script import ScriptDirectory
from redis import Redis
from sqlalchemy import text

from app.api.common import ok
from app.core.config import get_settings
from app.core.exceptions import FlagwaError
from app.database.session import get_engine
from app.services.nisar.earthdata_auth import earthdata_auth
from app.services.processing.capabilities import CAPABILITIES

router = APIRouter(prefix="/health", tags=["Health"])


@router.get("/live")
def live(request: Request):
    return ok(request, {"status": "alive"})


@router.get("/ready")
def ready(request: Request):
    settings = get_settings()
    checks = {"database": False, "postgis": False, "migrations": False, "redis": False, "staging": False}
    try:
        with get_engine().connect() as connection:
            checks["database"] = connection.scalar(text("SELECT 1")) == 1
            checks["postgis"] = bool(connection.scalar(text("SELECT PostGIS_Version()")))
            checks["migrations"] = connection.scalar(text("SELECT version_num FROM alembic_version")) == ScriptDirectory.from_config(Config("alembic.ini")).get_current_head()
    except Exception:
        pass
    try:
        with Redis.from_url(settings.redis_url.get_secret_value(), socket_timeout=2, socket_connect_timeout=2) as client:
            checks["redis"] = bool(client.ping())
    except Exception:
        pass
    try:
        import tempfile

        with tempfile.TemporaryFile(dir=settings.local_storage_path) as probe:
            probe.write(b"flagwa-readiness")
        checks["staging"] = True
    except OSError:
        pass
    if not all(checks.values()):
        raise FlagwaError("DEPENDENCIES_NOT_READY", "Unavailable dependencies: " + ", ".join(key for key, value in checks.items() if not value), 503)
    return ok(request, {"status": "ready", "checks": checks, "worker": "Run Celery inspect ping to verify worker consumers separately"})


@router.get("/providers")
def providers(request: Request):
    settings = get_settings()
    return ok(request, {"ASF": {"enabled": True, "catalogue": "public", "live_health": "not_checked_by_this_endpoint"},
                        "Earthdata": earthdata_auth().status(),
                        "Bhoonidhi": {"enabled": settings.bhoonidhi_enabled, "live_tested": False, "requires": "NRSC programmatic API authorization"},
                        "AI": {"enabled": False, "requested": settings.ai_enabled, "status": "not_implemented_optional"}, "analysis_capabilities": CAPABILITIES})