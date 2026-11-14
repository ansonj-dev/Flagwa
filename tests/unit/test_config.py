import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_token_and_secret_masking():
    settings = Settings(_env_file=None, earthdata_token="synthetic-test-secret")
    assert "synthetic-test-secret" not in repr(settings)
    assert settings.earthdata_token.get_secret_value() == "synthetic-test-secret"


@pytest.mark.parametrize("values", [
    {"earthdata_username": "synthetic-user"},
    {"app_env": "production", "admin_api_key": ""},
    {"storage_backend": "s3", "s3_bucket": ""},
    {"bhoonidhi_enabled": True},
    {"database_url": "sqlite:///wrong.db"},
])
def test_invalid_configuration(values):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **values)


def test_optional_providers_not_required():
    settings = Settings(_env_file=None)
    assert not settings.bhoonidhi_enabled
    assert not settings.ai_enabled
    assert "http://localhost:5173" in settings.allowed_origins


def test_unavailable_optional_ai_does_not_break_scientific_configuration():
    assert Settings(_env_file=None, ai_enabled=True).ai_enabled