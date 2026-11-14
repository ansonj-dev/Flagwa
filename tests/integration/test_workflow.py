from datetime import datetime, timezone
from uuid import uuid4

import h5py
import numpy as np
import pytest
import rasterio
from celery.contrib.testing.worker import start_worker
from geoalchemy2.shape import from_shape
from pyproj import Transformer
from rasterio.transform import from_origin
from shapely.geometry import box, mapping
from sqlalchemy import select, text

from app.database.session import session_factory
from app.models import AnalysisJob, Location, SatelliteScene
from app.schemas.analysis import ContextRegistration
from app.schemas.catalog import Scene
from app.services.catalog import persist_scene
from app.services.context.registry import register_context
from app.services.storage import get_storage
from app.workers.celery_app import celery_app
from app.workers.tasks import execute_job

pytestmark = pytest.mark.integration


def synthetic_inputs(tmp_path):
    identifier = uuid4().hex
    transformer = Transformer.from_crs(32643, 4326, always_xy=True)
    west, south = transformer.transform(499990, 999690)
    east, north = transformer.transform(500310, 1000010)
    aoi = mapping(box(west, south, east, north))
    location_slug = "synthetic-" + identifier
    with session_factory() as session:
        location = Location(name="SYNTHETIC TEST ONLY", slug=location_slug, country="Synthetic", continent="Synthetic",
                            hazard_type="flood", geometry=from_shape(box(west, south, east, north), srid=4326), is_active=False)
        session.add(location)
        session.commit()
        scene_ids = []
        for index, date in enumerate([datetime(2026, 10, 22, tzinfo=timezone.utc), datetime(2026, 11, 3, tzinfo=timezone.utc)]):
            scene_id = f"SYNTHETIC_{identifier}_{index}"
            scene_ids.append(scene_id)
            path = tmp_path / f"{scene_id}.h5"
            with h5py.File(path, "w") as product:
                group = product.create_group("science/LSAR/GCOV/grids/frequencyA")
                data = np.full((16, 16), .1, dtype="float32")
                if index:
                    data[4:12, 4:12] = .005
                group.create_dataset("HHHH", data=data)
                group.create_dataset("xCoordinates", data=500000 + np.arange(16) * 20)
                group.create_dataset("yCoordinates", data=1000000 - np.arange(16) * 20)
                group.create_dataset("projection", data=32643)
                group.create_dataset("mask", data=np.ones((16, 16), dtype="uint8"))
            scene = Scene(scene_id=scene_id, dataset="NISAR", product_type="GCOV", data_maturity="VALIDATED",
                          acquisition_datetime=date, frequency="L", polarizations=["HH"], flight_direction="DESCENDING", source="ASF",
                          geometry=aoi, orbit_information={"pathNumber": 1, "frameNumber": 1, "lookDirection": "RIGHT", "rangeBandwidth": ["20"], "crid": "SYNTHETIC"},
                          metadata={"original": {"properties": {"mainBandPolarization": ["HH"]}}, "synthetic_fixture": True})
            persist_scene(session, scene)
            session.flush()
            record = session.scalar(select(SatelliteScene).where(SatelliteScene.scene_id == scene_id))
            record.file_path = f"raw/synthetic/{scene_id}.h5"
            get_storage().put_file(path, record.file_path)
            record.download_status = "COMPLETED"
        session.commit()
        water = tmp_path / "SYNTHETIC_water.tif"
        with rasterio.open(water, "w", driver="GTiff", width=16, height=16, count=1, dtype="uint8", crs=32643,
                           transform=from_origin(499990, 1000010, 20, 20), nodata=255) as output:
            values = np.zeros((16, 16), dtype="uint8")
            values[0] = 1
            output.write(values, 1)
        registration = ContextRegistration(location_slug=location_slug, layer_type="permanent_water", source="SYNTHETIC TEST ONLY",
                                           source_url="https://example.invalid/synthetic", license="Synthetic test fixture", version="synthetic-1",
                                           retrieved_at="2026-11-14T00:00:00Z", crs="EPSG:32643", resolution="20 m", units="class",
                                           processing_notes="Synthetic fixture; never a real JRC or NISAR measurement")
        layer = register_context(session, water, registration)
    return {"location_slug": location_slug, "before_scene_id": scene_ids[0], "after_scene_id": scene_ids[1],
            "polarization": "HHHH", "frequency_group": "A", "permanent_water_layer_id": layer.id,
            "parameters": {"threshold_basis": "SYNTHETIC fixture thresholds, not real calibration", "quality_valid_values": [1],
                           "quality_rule_source": "SYNTHETIC fixture code: 1 is valid"}}


def test_migrations_readiness_and_locations(integration_environment):
    client = integration_environment
    from app.cli.seed_locations import seed_locations

    with session_factory() as session:
        assert session.scalar(text("SELECT version_num FROM alembic_version")) == "0002"
        assert session.scalar(text("SELECT PostGIS_Version()"))
        seed_locations(session)
        seed_locations(session)
    assert client.get("/health/ready").status_code == 200
    assert len(client.get("/api/v1/locations").json()["data"]) == 8
    assert client.get("/api/v1/locations/kuttanad/availability").json()["data"]["availability_status"] == "not_verified"
    assert client.get("/api/v1/community/kuttanad/population").status_code == 424


def test_api_real_broker_worker_synthetic_processing_exports(integration_environment, tmp_path):
    client = integration_environment
    payload = synthetic_inputs(tmp_path)
    with start_worker(celery_app, pool="solo", perform_ping_check=False, shutdown_timeout=20):
        response = client.post("/api/v1/analysis/flood", json=payload)
        assert response.status_code == 202, response.text
        job_id = response.json()["data"]["id"]
        task = celery_app.AsyncResult(job_id)
        returned = task.get(timeout=45, disable_sync_subtasks=False)
        assert returned["status"] == "COMPLETED", returned
        response = client.get(f"/api/v1/jobs/{job_id}/status")
        assert response.json()["data"]["status"] == "COMPLETED"
        result = client.get(f"/api/v1/results/{job_id}")
        assert result.status_code == 200
        assert result.json()["data"]["validation_status"] == "pending_validation"
        assert result.json()["data"]["statistics"]["candidate_area_m2"] > 0
        assert "artifacts" not in result.json()["data"]["metadata"]
        for name in ["geotiff", "geojson", "summary"]:
            response = client.get(f"/api/v1/exports/{job_id}/{name}")
            assert response.status_code == 200
            assert len(response.content) > 10
        assert client.get(f"/api/v1/results/{job_id}/preview").headers["content-type"] == "image/png"
        partial = client.get(f"/api/v1/exports/{job_id}/geotiff", headers={"Range": "bytes=0-127", "Origin": "http://localhost:5173"})
        assert partial.status_code == 206
        assert len(partial.content) == 128
        assert "Content-Range" in partial.headers["access-control-expose-headers"]
        assert client.get(f"/api/v1/community/{payload['location_slug']}/exposure", params={"result_id": job_id}).status_code == 424


def test_catalogue_persistence_and_no_path_disclosure(integration_environment, monkeypatch):
    client = integration_environment
    scene = Scene(scene_id="SYNTHETIC_CATALOGUE", source="ASF", dataset="NISAR",
                  metadata={"original": {"properties": {"url": "https://example.invalid/private?token=synthetic"}}})
    monkeypatch.setattr("app.api.v1.catalog.ASFClient.search", lambda *args: ([scene], False))
    for attempt in range(2):
        response = client.post("/api/v1/catalog/nisar/search", json={"bbox": [76, 9, 77, 10], "start": "2026-10-21T00:00:00Z", "end": "2026-11-14T23:59:59Z"})
        assert response.status_code == 200
        assert "private?token" not in response.text
    assert client.get("/api/v1/scenes/SYNTHETIC_CATALOGUE").status_code == 200


def test_cancelled_and_failed_tasks_never_publish_results(integration_environment):
    client = integration_environment
    with session_factory() as session:
        cancelled = AnalysisJob(job_type="flood", status="QUEUED", input_scenes=[], parameters={})
        failing = AnalysisJob(job_type="unsupported", status="QUEUED", input_scenes=[], parameters={})
        session.add_all([cancelled, failing])
        session.commit()
        cancelled_id, failing_id = cancelled.id, failing.id
    assert client.post(f"/api/v1/jobs/{cancelled_id}/cancel").json()["data"]["status"] == "CANCELLED"
    assert execute_job.apply(args=[cancelled_id]).get()["status"] == "CANCELLED"
    assert execute_job.apply(args=[failing_id]).get()["status"] == "FAILED"
    assert client.get(f"/api/v1/jobs/{failing_id}").json()["data"]["status"] == "FAILED"
    assert client.get(f"/api/v1/results/{failing_id}").status_code == 404