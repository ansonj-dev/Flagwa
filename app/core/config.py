from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    app_name: str = "FLAGWA Backend"
    app_env: Literal["development", "test", "production"] = "development"
    debug: bool = False
    api_v1_prefix: str = "/api/v1"
    database_url: SecretStr = SecretStr("postgresql+psycopg://localhost/flagwa")
    redis_url: SecretStr = SecretStr("redis://localhost:6379/0")
    earthdata_username: SecretStr = SecretStr("")
    earthdata_password: SecretStr = SecretStr("")
    earthdata_token: SecretStr = SecretStr("")
    bhoonidhi_enabled: bool = False
    bhoonidhi_username: SecretStr = SecretStr("")
    bhoonidhi_password: SecretStr = SecretStr("")
    storage_backend: Literal["local", "s3"] = "local"
    local_storage_path: Path = Path("storage")
    s3_endpoint_url: str | None = None
    s3_bucket: str = ""
    s3_access_key_id: SecretStr = SecretStr("")
    s3_secret_access_key: SecretStr = SecretStr("")
    s3_region: str = "us-east-1"
    cors_origins: str = "http://localhost:3000,http://localhost:5173"
    admin_api_key: SecretStr = SecretStr("")
    ai_enabled: bool = False
    ai_provider: str = ""
    ai_api_key: SecretStr = SecretStr("")
    ai_model: str = ""
    provider_timeout_seconds: int = Field(default=60, ge=1, le=300)
    asf_cdn_hosts: str = "d1mv8zhcvry6x4.cloudfront.net"
    max_download_bytes: int = Field(default=50_000_000_000, gt=0)
    max_processing_pixels: int = Field(default=16_000_000, gt=0)
    min_free_disk_bytes: int = Field(default=1_000_000_000, ge=0)
    max_request_bytes: int = Field(default=1_048_576, gt=0)
    expensive_requests_per_minute: int = Field(default=20, ge=1)
    live_provider_tests: bool = False

    @field_validator("s3_endpoint_url", mode="before")
    @classmethod
    def empty_endpoint(cls, value):
        return value or None

    @model_validator(mode="after")
    def validate_configuration(self):
        if bool(self.earthdata_username.get_secret_value()) != bool(self.earthdata_password.get_secret_value()):
            raise ValueError("EARTHDATA_USERNAME and EARTHDATA_PASSWORD must be set together")
        if self.bhoonidhi_enabled and not (
            self.bhoonidhi_username.get_secret_value() and self.bhoonidhi_password.get_secret_value()
        ):
            raise ValueError("Enabled Bhoonidhi requires separately authorized API credentials")
        if self.storage_backend == "s3" and not self.s3_bucket:
            raise ValueError("S3_BUCKET is required for S3 storage")
        if self.app_env == "production" and not self.admin_api_key.get_secret_value():
            raise ValueError("ADMIN_API_KEY is required in production")
        if not self.database_url.get_secret_value().startswith("postgresql+psycopg://"):
            raise ValueError("DATABASE_URL must use PostgreSQL with the psycopg driver")
        if not self.api_v1_prefix.startswith("/") or self.api_v1_prefix.endswith("/"):
            raise ValueError("API_V1_PREFIX must start with / and have no trailing slash")
        return self

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    try:
        return Settings()
    except ValidationError as error:
        messages = [".".join(map(str, item["loc"])) + ": " + item["msg"] for item in error.errors(include_input=False)]
        raise RuntimeError("Invalid backend configuration: " + "; ".join(messages)) from None