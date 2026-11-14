from datetime import datetime, timezone
from uuid import uuid4

from geoalchemy2 import Geometry
from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database.session import Base


def new_id():
    return str(uuid4())


def utcnow():
    return datetime.now(timezone.utc)


class Location(Base):
    __tablename__ = "locations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(100), unique=True)
    country: Mapped[str] = mapped_column(String(100))
    continent: Mapped[str] = mapped_column(String(100))
    hazard_type: Mapped[str] = mapped_column(String(80))
    geometry = mapped_column(Geometry("GEOMETRY", srid=4326, spatial_index=True), nullable=True)
    description: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)


class CaseStudy(Base):
    __tablename__ = "case_studies"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    location_id: Mapped[str] = mapped_column(ForeignKey("locations.id"), index=True)
    slug: Mapped[str] = mapped_column(String(100), unique=True)
    title: Mapped[str] = mapped_column(String(240))
    scientific_question: Mapped[str] = mapped_column(Text)
    vulnerability_context: Mapped[str] = mapped_column(Text, default="Not independently assessed")
    data_status: Mapped[str] = mapped_column(String(60), default="unverified")
    priority: Mapped[int] = mapped_column(Integer, default=2)
    description: Mapped[str] = mapped_column(Text, default="Research location; no operational data claim")


class SatelliteScene(Base):
    __tablename__ = "satellite_scenes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    scene_id: Mapped[str] = mapped_column(String(300), unique=True)
    provider: Mapped[str] = mapped_column(String(30))
    satellite: Mapped[str | None] = mapped_column(String(40))
    product_type: Mapped[str | None] = mapped_column(String(20))
    data_maturity: Mapped[str | None] = mapped_column(String(30))
    acquisition_datetime: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    processing_datetime: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    frequency: Mapped[str | None] = mapped_column(String(30))
    polarization: Mapped[list] = mapped_column(JSONB, default=list)
    flight_direction: Mapped[str | None] = mapped_column(String(30))
    orbit_information: Mapped[dict] = mapped_column(JSONB, default=dict)
    footprint = mapped_column(Geometry("GEOMETRY", srid=4326, spatial_index=True), nullable=True)
    file_path: Mapped[str | None] = mapped_column(Text)
    download_status: Mapped[str] = mapped_column(String(30), default="NOT_REQUESTED")
    metadata_json: Mapped[dict] = mapped_column(JSONB, default=dict)


class AnalysisJob(Base):
    __tablename__ = "analysis_jobs"
    __table_args__ = (
        CheckConstraint("progress >= 0 AND progress <= 100", name="job_progress_range"),
        CheckConstraint("status IN ('QUEUED','RUNNING','VALIDATING','COMPLETED','FAILED','CANCELLED')", name="job_status_valid"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    location_id: Mapped[str | None] = mapped_column(ForeignKey("locations.id"), index=True)
    job_type: Mapped[str] = mapped_column(String(50))
    status: Mapped[str] = mapped_column(String(30), default="QUEUED", index=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    input_scenes: Mapped[list] = mapped_column(JSONB, default=list)
    parameters: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error_message: Mapped[str | None] = mapped_column(Text)


class AnalysisResult(Base):
    __tablename__ = "analysis_results"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    analysis_job_id: Mapped[str] = mapped_column(ForeignKey("analysis_jobs.id"), unique=True)
    result_type: Mapped[str] = mapped_column(String(50))
    output_path: Mapped[str] = mapped_column(Text)
    preview_path: Mapped[str | None] = mapped_column(Text)
    output_geometry = mapped_column(Geometry("GEOMETRY", srid=4326, spatial_index=True), nullable=True)
    statistics: Mapped[dict] = mapped_column(JSONB, default=dict)
    validation_status: Mapped[str] = mapped_column(String(40), default="pending_validation")
    uncertainty_notes: Mapped[list] = mapped_column(JSONB, default=list)
    metadata_json: Mapped[dict] = mapped_column(JSONB, default=dict)


class DataSource(Base):
    __tablename__ = "data_sources"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(200))
    url: Mapped[str] = mapped_column(Text)
    license: Mapped[str] = mapped_column(Text)
    version: Mapped[str] = mapped_column(String(100))
    retrieved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    metadata_json: Mapped[dict] = mapped_column(JSONB, default=dict)


class ContextLayer(Base):
    __tablename__ = "context_layers"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    location_id: Mapped[str] = mapped_column(ForeignKey("locations.id"), index=True)
    data_source_id: Mapped[str] = mapped_column(ForeignKey("data_sources.id"))
    layer_type: Mapped[str] = mapped_column(String(60))
    source: Mapped[str] = mapped_column(String(200))
    version: Mapped[str] = mapped_column(String(100))
    file_path: Mapped[str] = mapped_column(Text)
    geometry = mapped_column(Geometry("GEOMETRY", srid=4326, spatial_index=True), nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSONB, default=dict)