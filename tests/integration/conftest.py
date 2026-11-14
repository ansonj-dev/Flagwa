import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.config import get_settings
from app.core.security import expensive_request, require_admin
from app.database.session import Base, session_factory
from app.main import app
from app.services.storage import get_storage


@pytest.fixture
def integration_environment(tmp_path):
    if os.getenv("RUN_INTEGRATION_TESTS") != "true":
        pytest.skip("Set RUN_INTEGRATION_TESTS=true with an isolated flagwa_test PostGIS database and Redis")
    settings = get_settings()
    assert settings.app_env == "test", "Integration tests require APP_ENV=test"
    with session_factory() as session:
        assert session.scalar(text("SELECT current_database()")) == "flagwa_test", "Only the disposable flagwa_test database is permitted"
    original_path = settings.local_storage_path
    settings.local_storage_path = tmp_path / "synthetic-storage"
    settings.local_storage_path.mkdir()
    get_storage.cache_clear()
    app.dependency_overrides[require_admin] = lambda: None
    app.dependency_overrides[expensive_request] = lambda: None
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()
        settings.local_storage_path = original_path
        get_storage.cache_clear()
        with session_factory() as session:
            for table in reversed(Base.metadata.sorted_tables):
                session.execute(table.delete())
            session.commit()