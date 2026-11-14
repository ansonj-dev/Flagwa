import pytest
from types import SimpleNamespace
from unittest.mock import MagicMock
from fastapi.testclient import TestClient

from app.core.exceptions import FlagwaError
from app.core.security import expensive_request
from app.main import app


@pytest.fixture
def client():
    with TestClient(app) as client:
        yield client


def test_live_and_provider_health(client):
    response = client.get("/health/live")
    assert response.status_code == 200
    assert response.json()["data"]["status"] == "alive"
    assert response.headers["x-request-id"] == response.json()["meta"]["request_id"]
    response = client.get("/health/providers")
    assert response.status_code == 200
    assert "earthdata_token" not in response.text
    assert response.json()["data"]["analysis_capabilities"]["deformation"]["operational"] is False
    origin = "http://localhost:5173"
    preflight = client.options("/api/v1/exports/synthetic/geotiff", headers={"Origin": origin,
                               "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "Range"})
    assert preflight.status_code == 200
    response = client.get("/health/live", headers={"Origin": origin})
    assert "Content-Range" in response.headers["access-control-expose-headers"]


def test_openapi_has_all_analysis_and_result_routes(client):
    response = client.get("/openapi.json")
    assert response.status_code == 200
    paths = response.json()["paths"]
    for theme in ["flood", "forest", "agriculture", "glacier", "wildfire", "deformation"]:
        assert f"/api/v1/analysis/{theme}" in paths
    assert "/api/v1/exports/{result_id}/geotiff" in paths
    assert "/api/v1/community/{location_slug}/exposure" in paths


def test_errors_and_size_limit(client):
    assert client.get("/not-real").json()["success"] is False
    response = client.get("/api/v1/jobs/invalid-uuid")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    response = client.post("/api/v1/catalog/nisar/search", content=b"x" * 1_048_577)
    assert response.status_code == 413


def test_write_protection(client):
    response = client.post("/api/v1/scenes/SYNTHETIC/download")
    assert response.status_code == 403


def test_provider_failure_format(client, monkeypatch):
    app.dependency_overrides[expensive_request] = lambda: None
    def fail(*args):
        raise FlagwaError("ASF_SEARCH_FAILED", "Provider unavailable", 502)
    monkeypatch.setattr("app.api.v1.catalog.ASFClient.search", fail)
    try:
        response = client.post("/api/v1/catalog/nisar/search", json={"bbox": [76, 9, 77, 10], "start": "2026-10-21T00:00:00Z", "end": "2026-11-14T23:59:59Z"})
        assert response.status_code == 502
        assert response.json()["success"] is False
    finally:
        app.dependency_overrides.clear()


def test_readiness_reports_object_storage_failure_without_raw_error(tmp_path, monkeypatch):
    from app.api import health
    from app.core.config import Settings

    settings = Settings(_env_file=None, storage_backend="s3", s3_bucket="synthetic-readiness-bucket", local_storage_path=tmp_path)
    monkeypatch.setattr(health, "get_settings", lambda: settings)
    monkeypatch.setattr(health, "get_engine", lambda: (_ for _ in ()).throw(RuntimeError("synthetic database unavailable")))
    monkeypatch.setattr(health.Redis, "from_url", lambda *args, **kwargs: MagicMock())
    monkeypatch.setattr(health, "get_storage", lambda: (_ for _ in ()).throw(RuntimeError("synthetic private provider diagnostic")))
    with pytest.raises(FlagwaError) as caught:
        health.ready(SimpleNamespace(state=SimpleNamespace(request_id="synthetic-request")))
    assert caught.value.status == 503
    assert "artifact_storage" in caught.value.message
    assert "private provider diagnostic" not in caught.value.message