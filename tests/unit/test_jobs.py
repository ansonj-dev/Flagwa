from types import SimpleNamespace

import pytest
from sqlalchemy.schema import CreateTable
from sqlalchemy.dialects.postgresql import dialect

from app.core.exceptions import FlagwaError
from app.database.session import Base
from app.models import AnalysisJob
from app.services.jobs import transition


def test_job_lifecycle():
    job = SimpleNamespace(status="QUEUED", progress=0)
    for status in ["RUNNING", "VALIDATING", "COMPLETED"]:
        transition(job, status)
    assert job.progress == 100
    assert job.completed_at >= job.started_at
    with pytest.raises(FlagwaError):
        transition(job, "FAILED")


@pytest.mark.parametrize("status", ["FAILED", "CANCELLED"])
def test_terminal_job_never_completed(status):
    job = SimpleNamespace(status=status, progress=0)
    with pytest.raises(FlagwaError):
        transition(job, "COMPLETED")


def test_postgis_schema_compiles():
    assert len(Base.metadata.tables) == 7
    for table in Base.metadata.sorted_tables:
        assert str(CreateTable(table).compile(dialect=dialect()))
    assert "job_status_valid" in str(CreateTable(AnalysisJob.__table__).compile(dialect=dialect()))


def test_invalid_progress_never_mutates_status():
    job = SimpleNamespace(status="QUEUED", progress=0)
    with pytest.raises(FlagwaError):
        transition(job, "RUNNING", 101)
    assert job.status == "QUEUED"