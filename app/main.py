import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from time import monotonic
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException
from starlette.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.api.v1.router import router as v1_router
from app.core.config import get_settings
from app.core.exceptions import FlagwaError
from app.core.logging import configure_logging
from app.database.session import get_engine

settings = get_settings()
configure_logging()
logger = logging.getLogger("flagwa.api")


@asynccontextmanager
async def lifespan(app):
    settings.local_storage_path.mkdir(parents=True, exist_ok=True)
    yield
    get_engine().dispose()


app = FastAPI(title=settings.app_name, version="0.1.0", debug=False, lifespan=lifespan,
              description="NISAR catalogue and candidate surface-change backend. No result is scientifically validated by default.")
app.add_middleware(CORSMiddleware, allow_origins=settings.allowed_origins, allow_credentials=False,
                   allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["Content-Type", "X-Admin-Key", "X-Request-ID", "Range", "If-Range"],
                   expose_headers=["X-Request-ID", "Content-Disposition", "Content-Range", "Accept-Ranges", "ETag"])


def error_response(request, code, message, status):
    return JSONResponse(status_code=status, content={"success": False, "error": {"code": code, "message": message},
                        "meta": {"request_id": getattr(request.state, "request_id", str(uuid4())), "timestamp": datetime.now(timezone.utc).isoformat()}})


@app.middleware("http")
async def request_context(request: Request, call_next):
    request.state.request_id = str(uuid4())
    start = monotonic()
    response = await call_next(request)
    response.headers["X-Request-ID"] = request.state.request_id
    logger.info("request_id=%s method=%s status=%s duration_ms=%d", request.state.request_id, request.method, response.status_code, int((monotonic() - start) * 1000))
    return response


class RequestSizeLimit:
    def __init__(self, app, limit):
        self.app, self.limit = app, limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in {"POST", "PUT", "PATCH"}:
            return await self.app(scope, receive, send)
        messages, size = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            size += len(message.get("body", b""))
            if size > self.limit:
                response = JSONResponse(status_code=413, content={"success": False, "error": {"code": "REQUEST_TOO_LARGE", "message": "Request exceeds configured size limit"}, "meta": {"request_id": str(uuid4())}})
                return await response(scope, receive, send)
            messages.append(message)
            if not message.get("more_body", False):
                break

        async def replay():
            if messages:
                return messages.pop(0)
            return await receive()

        await self.app(scope, replay, send)


app.add_middleware(RequestSizeLimit, limit=settings.max_request_bytes)


@app.exception_handler(FlagwaError)
async def flagwa_error(request, error):
    return error_response(request, error.code, error.message, error.status)


@app.exception_handler(RequestValidationError)
async def validation_error(request, error):
    fields = sorted({".".join(str(item) for item in entry["loc"]) for entry in error.errors()})
    return error_response(request, "VALIDATION_ERROR", "Invalid request fields: " + ", ".join(fields), 422)


@app.exception_handler(HTTPException)
async def http_error(request, error):
    return error_response(request, "HTTP_ERROR", "Request was not accepted", error.status_code)


@app.exception_handler(SQLAlchemyError)
async def database_error(request, error):
    return error_response(request, "DATABASE_UNAVAILABLE", "Database operation failed; check service readiness", 503)


@app.exception_handler(Exception)
async def unexpected_error(request, error):
    logger.error("request_id=%s error_type=%s", getattr(request.state, "request_id", "unknown"), type(error).__name__)
    return error_response(request, "INTERNAL_ERROR", "Unexpected server error", 500)


app.include_router(health_router)
app.include_router(v1_router, prefix=settings.api_v1_prefix)