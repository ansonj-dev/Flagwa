from datetime import datetime, timezone
from datetime import timedelta
from uuid import uuid4
import shutil

import h5py
import numpy as np
import pytest
import rasterio
from celery.contrib.testing.worker import start_worker
from geoalchemy2.shape import from_shape
from pyproj import Transformer
from rasterio.transform import from_origin
from shapely.geometry import box, mapping, shape
from sqlalchemy import select, text

from app.database.session import session_factory
from app.models import AnalysisJob, ContextLayer, Location, SatelliteScene
from app.schemas.analysis import ContextRegistration
from app.schemas.catalog import Scene
from app.services.catalog import persist_scene
from app.services.context.registry import register_context
from app.services.storage import get_storage
from app.workers.celery_app import celery_app
from app.workers.tasks import execute_job
from app.workers.tasks import update_progress
from app.workers.heartbeat import JobHeartbeat
from app.services.maintenance import cleanup_partials, reconcile_jobs
from app.core.config import get_settings
from app.core.exceptions import FlagwaError
from app.services.jobs import transition
from redis import Redis

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
                                           processing_notes="Synthetic fixture; never a real JRC or NISAR measurement", is_synthetic=True)
        layer = register_context(session, water, registration)
    return {"location_slug": location_slug, "before_scene_id": scene_ids[0], "after_scene_id": scene_ids[1],
            "polarization": "HHHH", "frequency_group": "A", "permanent_water_layer_id": layer.id,
            "parameters": {"threshold_basis": "SYNTHETIC fixture thresholds, not real calibration", "quality_valid_values": [1],
                           "quality_rule_source": "SYNTHETIC fixture code: 1 is valid"}}


def test_migrations_readiness_and_locations(integration_environment):
    client = integration_environment
    from app.cli.seed_locations import seed_locations

    with session_factory() as session:
        from alembic.config import Config
        from alembic.script import ScriptDirectory
        assert session.scalar(text("SELECT version_num FROM alembic_version")) == ScriptDirectory.from_config(Config("alembic.ini")).get_current_head()
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
        assert result.json()["data"]["metadata"]["synthetic"] is True
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


def advanced_synthetic_payload(tmp_path, theme):
    base = synthetic_inputs(tmp_path)
    identifiers = [base["before_scene_id"], base["after_scene_id"]]
    with session_factory() as session:
        water = session.get(ContextLayer, base["permanent_water_layer_id"])

        def context(layer_type):
            target = tmp_path / f"SYNTHETIC_{layer_type}.tif"
            with rasterio.open(get_storage().get_file(water.file_path)) as source:
                profile = source.profile
            with rasterio.open(target, "w", **profile) as output:
                output.write(np.ones((16, 16), dtype="uint8"), 1)
            values = {key: value for key, value in water.metadata_json.items() if key in ContextRegistration.model_fields}
            values["layer_type"] = layer_type
            return register_context(session, target, ContextRegistration.model_validate(values)).id

        for identifier in identifiers:
            scene = session.scalar(select(SatelliteScene).where(SatelliteScene.scene_id == identifier))
            scene.polarization = ["HH", "HV"]
            scene.metadata_json = dict(scene.metadata_json, original={"properties": {"mainBandPolarization": ["HH", "HV"]}})
            with h5py.File(get_storage().get_file(scene.file_path), "a") as product:
                group = product["science/LSAR/GCOV/grids/frequencyA"]
                group.create_dataset("HVHV", data=group["HHHH"][()])
                identity = product.require_group("science/LSAR/identification")
                for key, value in {"granuleId": identifier, "productType": "GCOV", "hasInputDataException": 0}.items():
                    identity.create_dataset(key, data=value)
        session.commit()
        parameters = {"quality_valid_values": [1], "quality_rule_source": "SYNTHETIC fixture valid subswath code is 1",
                      "scientific_basis": "SYNTHETIC test only, not calibrated for real observations"}
        pair = {key: value for key, value in base.items() if key in {"location_slug", "before_scene_id", "after_scene_id", "polarization", "frequency_group"}}
        if theme == "forest":
            return pair | {"landcover_layer_id": context("landcover"), "forest_classes": [1], "cross_polarization": "HVHV",
                           "parameters": parameters | {"smoothing_kernel": 1}}
        if theme == "wildfire":
            return pair | {"burn_perimeter_layer_id": context("fire_perimeter"), "optical_burn_layer_id": context("optical_burn"),
                           "event_datetime": "2026-10-27T00:00:00Z", "cross_polarization": "HVHV", "parameters": parameters | {"smoothing_kernel": 1}}
        first = session.scalar(select(SatelliteScene).where(SatelliteScene.scene_id == identifiers[0]))
        if theme == "agriculture":
            from app.services.catalog import scene_model

            extra = scene_model(first).model_copy(deep=True, update={"scene_id": "SYNTHETIC_EXTRA_" + uuid4().hex,
                                                                    "acquisition_datetime": datetime(2026, 11, 15, tzinfo=timezone.utc)})
            persist_scene(session, extra)
            record = session.scalar(select(SatelliteScene).where(SatelliteScene.scene_id == extra.scene_id))
            target = tmp_path / "SYNTHETIC_third_date.h5"
            shutil.copyfile(get_storage().get_file(first.file_path), target)
            with h5py.File(target, "a") as product:
                product["science/LSAR/identification/granuleId"][()] = extra.scene_id
            record.file_path = f"raw/synthetic/{extra.scene_id}.h5"
            get_storage().put_file(target, record.file_path)
            record.download_status = "COMPLETED"
            session.commit()
            return {"location_slug": base["location_slug"], "scene_ids": identifiers + [extra.scene_id], "landcover_layer_id": context("landcover"),
                    "agriculture_classes": [1], "parameters": parameters}
        product_type = "GOFF" if theme == "glacier" else "GUNW"
        first.product_type = product_type
        prefix = f"/science/LSAR/{product_type}/grids/frequencyA"
        with h5py.File(get_storage().get_file(first.file_path), "a") as product:
            identity = product["science/LSAR/identification"]
            identity["productType"][()] = product_type
            identity.create_dataset("referenceZeroDopplerStartTime", data="2026-10-22T00:00:00Z")
            identity.create_dataset("secondaryZeroDopplerStartTime", data="2026-11-03T00:00:00Z")
            group = product.create_group(prefix)
            for key in ["xCoordinates", "yCoordinates", "projection"]:
                group.create_dataset(key, data=product[f"science/LSAR/GCOV/grids/frequencyA/{key}"][()])
            if theme == "glacier":
                measurements = {"alongTrackOffset": (3, "m"), "slantRangeOffset": (4, "m"), "correlation": (.9, "1")}
            else:
                measurements = {"unwrappedPhase": (.2, "radians"), "coherenceMagnitude": (.9, "1"), "connectedComponents": (1, "1")}
            for key, (value, units) in measurements.items():
                group.create_dataset(key, data=np.full((16, 16), value, dtype="float32")).attrs["units"] = units
            if theme == "deformation":
                product.create_dataset("/science/LSAR/GUNW/metadata/centerFrequency", data=1.25e9).attrs["units"] = "Hz"
        session.commit()
        single = {"scene_id": first.scene_id, "location_slug": base["location_slug"]}
        if theme == "glacier":
            return single | {"along_track_dataset": prefix + "/alongTrackOffset", "slant_range_dataset": prefix + "/slantRangeOffset",
                             "quality_dataset": prefix + "/correlation", "glacier_layer_id": context("glacier_extent"),
                             "parameters": {"minimum_quality": .5, "quality_metric": "correlation", "quality_rule_source": "SYNTHETIC correlation quality threshold only",
                                            "scientific_basis": "SYNTHETIC offsets, not a measured glacier"}}
        longitude, latitude = Transformer.from_crs(32643, 4326, always_xy=True).transform(500000, 1000000)
        return single | {"phase_dataset": prefix + "/unwrappedPhase", "coherence_dataset": prefix + "/coherenceMagnitude",
                         "connected_components_dataset": prefix + "/connectedComponents", "center_frequency_dataset": "/science/LSAR/GUNW/metadata/centerFrequency",
                         "parameters": {"reference_point": [longitude, latitude], "reference_justification": "SYNTHETIC constant phase reference pixel only",
                                        "phase_to_range_sign": -1, "phase_convention_source": "SYNTHETIC known sign for an arithmetic test",
                                        "correction_assessment": "SYNTHETIC fixture; no real atmosphere or orbital error is represented"}}


@pytest.mark.parametrize("theme", ["forest", "wildfire", "agriculture", "glacier", "deformation"])
def test_advanced_jobs_run_distinct_experimental_workflows(integration_environment, tmp_path, theme):
    client = integration_environment
    payload = advanced_synthetic_payload(tmp_path, theme)
    with start_worker(celery_app, pool="solo", perform_ping_check=False, shutdown_timeout=20):
        response = client.post(f"/api/v1/analysis/{theme}", json=payload)
        assert response.status_code == 202, response.text
        job_id = response.json()["data"]["id"]
        completed = celery_app.AsyncResult(job_id).get(timeout=45, disable_sync_subtasks=False)
        assert completed["status"] == "COMPLETED", completed
    result = client.get(f"/api/v1/results/{job_id}").json()["data"]
    assert result["validation_status"] == "pending_validation"
    assert result["metadata"]["synthetic"] is True
    assert result["metadata"]["operational"] is False
    assert client.get(f"/api/v1/exports/{job_id}/geotiff").status_code == 200
    assert client.get(f"/api/v1/exports/{job_id}/summary").status_code == 200
    assert client.get(f"/api/v1/results/{job_id}/preview").status_code == 200
    if theme in {"agriculture", "glacier", "deformation"}:
        response = client.get(f"/api/v1/community/{payload['location_slug']}/exposure", params={"result_id": job_id})
        assert response.status_code == 422


def test_recovery_never_fails_a_live_lease(integration_environment):
    old = datetime.now(timezone.utc) - timedelta(hours=2)
    with session_factory() as session:
        dead = AnalysisJob(job_type="flood", status="RUNNING", input_scenes=[], parameters={}, started_at=old, heartbeat_at=old)
        alive = AnalysisJob(job_type="flood", status="RUNNING", input_scenes=[], parameters={}, started_at=old, heartbeat_at=old)
        session.add_all([dead, alive])
        session.commit()
        with Redis.from_url(get_settings().redis_url.get_secret_value()) as client:
            key = f"flagwa:job-lock:{alive.id}"
            client.set(key, "SYNTHETIC_LEASE", ex=60)
            try:
                report = reconcile_jobs(session, client)
                assert report["reconciled_job_ids"] == [dead.id]
                session.refresh(dead)
                session.refresh(alive)
                assert dead.status == "FAILED"
                assert alive.status == "RUNNING"
            finally:
                client.delete(key)


def test_heartbeat_renews_owned_lease_and_detects_cancellation(integration_environment):
    with session_factory() as session:
        job = AnalysisJob(job_type="flood", status="RUNNING", input_scenes=[], parameters={})
        session.add(job)
        session.commit()
        identifier = job.id
    with Redis.from_url(get_settings().redis_url.get_secret_value()) as client:
        lock = client.lock(f"flagwa:job-lock:{identifier}", timeout=30, thread_local=False)
        assert lock.acquire(blocking=False)
        heartbeat = JobHeartbeat(identifier, lock)
        try:
            assert heartbeat.pulse()
            assert client.ttl(lock.name) > 60
            with session_factory() as session:
                current = session.get(AnalysisJob, identifier)
                assert current.heartbeat_at is not None
                transition(current, "CANCELLED")
                session.commit()
            assert not heartbeat.pulse()
            with pytest.raises(FlagwaError):
                heartbeat.check()
            with pytest.raises(FlagwaError):
                update_progress(identifier, 90)
        finally:
            heartbeat.close()
            lock.release()


def test_retry_creates_one_new_job_and_preserves_failed_history(integration_environment, tmp_path, monkeypatch):
    client = integration_environment
    payload = synthetic_inputs(tmp_path)
    monkeypatch.setattr(execute_job, "apply_async", lambda **kwargs: None)
    with session_factory() as session:
        location = session.scalar(select(Location).where(Location.slug == payload["location_slug"]))
        original = AnalysisJob(job_type="flood", status="FAILED", location_id=location.id,
                               input_scenes=[payload["before_scene_id"], payload["after_scene_id"]], parameters=payload)
        session.add(original)
        session.commit()
        identifier = original.id
    first = client.post(f"/api/v1/jobs/{identifier}/retry")
    second = client.post(f"/api/v1/jobs/{identifier}/retry")
    assert first.status_code == second.status_code == 202
    assert first.json()["data"]["id"] == second.json()["data"]["id"]
    assert first.json()["data"]["id"] != identifier
    assert client.get(f"/api/v1/jobs/{identifier}").json()["data"]["status"] == "FAILED"


def test_partial_cleanup_is_dry_run_first_and_refuses_active_jobs(integration_environment, tmp_path):
    import os
    from time import time

    root = tmp_path / "cleanup"
    root.mkdir()
    old = root / "SYNTHETIC_old.partial"
    old.write_text("synthetic partial fixture")
    current = root / "SYNTHETIC_current.partial"
    current.write_text("synthetic active-age fixture")
    complete = root / "SYNTHETIC_complete.tif"
    complete.write_bytes(b"synthetic completed data must survive")
    os.utime(old, (time() - 172800, time() - 172800))
    with session_factory() as session:
        assert cleanup_partials(session, root)["count"] == 1
        assert old.exists()
        assert cleanup_partials(session, root, apply=True)["count"] == 1
        assert not old.exists() and current.exists() and complete.exists()
        session.add(AnalysisJob(job_type="flood", status="QUEUED", input_scenes=[], parameters={}))
        session.commit()
        with pytest.raises(FlagwaError) as caught:
            cleanup_partials(session, root, apply=True)
        assert caught.value.code == "CLEANUP_JOBS_ACTIVE"


def test_validation_job_records_metrics_but_never_approves_synthetic_data(integration_environment, tmp_path):
    client = integration_environment
    payload = synthetic_inputs(tmp_path)
    with start_worker(celery_app, pool="solo", perform_ping_check=False, shutdown_timeout=20):
        submitted = client.post("/api/v1/analysis/flood", json=payload)
        result_id = submitted.json()["data"]["id"]
        assert celery_app.AsyncResult(result_id).get(timeout=45, disable_sync_subtasks=False)["status"] == "COMPLETED"
        original_raster = client.get(f"/api/v1/exports/{result_id}/geotiff").content
        with session_factory() as session:
            water = session.get(ContextLayer, payload["permanent_water_layer_id"])
            reference_path = tmp_path / "SYNTHETIC_independent_reference.tif"
            with rasterio.open(get_storage().get_file(water.file_path)) as source:
                profile = source.profile
            values = np.zeros((16, 16), dtype="uint8")
            values[4:12, 4:12] = 1
            with rasterio.open(reference_path, "w", **profile) as output:
                output.write(values, 1)
            registration = {key: value for key, value in water.metadata_json.items() if key in ContextRegistration.model_fields}
            registration.update(layer_type="independent_validation", source="SYNTHETIC independent optical fixture",
                                validation_evidence={"target": "potential_inundation", "sensor": "SYNTHETIC optical fixture",
                                "observation_datetime": "2026-11-03T00:00:00Z", "independent_of_nisar": True,
                                "mapping_method": "Synthetic held-out pixel mask for a software test, not actual validation evidence"})
            reference = register_context(session, reference_path, ContextRegistration.model_validate(registration))
        review = {"reference_layer_id": reference.id, "reference_positive_values": [1], "minimum_iou": .7,
                  "minimum_precision": .7, "minimum_recall": .7, "reviewed_by": "synthetic-test-operator",
                  "review_notes": "SYNTHETIC workflow assessment only; never genuine scientific approval",
                  "independence_statement": "Synthetic reference is a separate fixture for arithmetic testing only"}
        response = client.post(f"/api/v1/results/{result_id}/validation", json=review)
        assert response.status_code == 202, response.text
        validation_id = response.json()["data"]["id"]
        assert celery_app.AsyncResult(validation_id).get(timeout=45, disable_sync_subtasks=False)["status"] == "COMPLETED"
        result = client.get(f"/api/v1/results/{result_id}").json()["data"]
        assert result["validation_status"] == "pending_validation"
        record = result["metadata"]["validation_history"][-1]
        assert record["metrics"]["iou"] == 1
        assert not record["approved"]
        assert result["metadata"]["validation_sources"][-1]["reference_layer_id"] == reference.id
        assert client.get(f"/api/v1/exports/{result_id}/geotiff").content == original_raster
        summary = client.get(f"/api/v1/exports/{result_id}/summary").json()
        assert summary["validation_history"][-1]["validation_job_id"] == validation_id
        refusal = client.post(f"/api/v1/results/{result_id}/validation", json=review | {"approve": True})
        assert refusal.status_code == 422
        assert refusal.json()["error"]["code"] == "SYNTHETIC_VALIDATION_FORBIDDEN"


def test_inspection_exposes_dataset_names_not_server_file_paths(integration_environment, tmp_path):
    from app.services.processing.hdf5_reader import inspect_product

    client = integration_environment
    payload = synthetic_inputs(tmp_path)
    with session_factory() as session:
        scene = session.scalar(select(SatelliteScene).where(SatelliteScene.scene_id == payload["before_scene_id"]))
        scene.metadata_json = dict(scene.metadata_json, hdf5=inspect_product(get_storage().get_file(scene.file_path)))
        session.commit()
    response = client.get(f"/api/v1/scenes/{payload['before_scene_id']}/inspection", params={"contains": "HHHH"})
    assert response.status_code == 200
    assert response.json()["data"]["datasets"][0]["dataset_path"].endswith("/HHHH")
    assert str(tmp_path) not in response.text
    assert '"file_path"' not in response.text


def test_reviewed_aoi_refuses_active_jobs_and_preserves_snapshots(integration_environment, tmp_path, monkeypatch):
    import json
    from geoalchemy2.shape import to_shape
    from app.services.study_areas import set_study_area, study_context

    client = integration_environment
    payload = synthetic_inputs(tmp_path)
    monkeypatch.setattr(execute_job, "apply_async", lambda **kwargs: None)
    submitted = client.post("/api/v1/analysis/flood", json=payload)
    assert submitted.status_code == 202
    identifier = submitted.json()["data"]["id"]
    snapshot = shape(submitted.json()["data"]["parameters"]["_study_aoi"])
    with session_factory() as session:
        water = session.get(ContextLayer, payload["permanent_water_layer_id"])
        location = session.scalar(select(Location).where(Location.slug == payload["location_slug"]))
        west, south, east, north = to_shape(location.geometry).bounds
        polygon = box(west + .0001, south + .0001, east - .0001, north - .0001)
        boundary = tmp_path / "SYNTHETIC_reviewed_boundary.geojson"
        boundary.write_text(json.dumps({"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": mapping(polygon), "properties": {"label": "SYNTHETIC boundary fixture"}}]}))
        values = {key: value for key, value in water.metadata_json.items() if key in ContextRegistration.model_fields}
        values.update(layer_type="boundaries", crs="EPSG:4326", units="features", resolution="vector")
        registration = ContextRegistration.model_validate(values)
        with pytest.raises(FlagwaError) as caught:
            set_study_area(session, boundary, registration, "synthetic-operator")
        assert caught.value.code == "AOI_JOBS_ACTIVE"
    client.post(f"/api/v1/jobs/{identifier}/cancel")
    with session_factory() as session:
        layer = set_study_area(session, boundary, registration, "synthetic-operator")
        location = session.scalar(select(Location).where(Location.slug == payload["location_slug"]))
        actual, provenance = study_context(session, location)
        assert shape(actual).equals(polygon)
        assert provenance["status"] == "reviewed"
        assert provenance["source_layer_id"] == layer.id
        assert shape(session.get(AnalysisJob, identifier).parameters["_study_aoi"]).equals(snapshot)


@pytest.mark.parametrize("backlog", [0, 1])
def test_queued_message_loss_is_distinct_from_real_broker_backlog(integration_environment, backlog):
    from types import SimpleNamespace

    old = datetime.now(timezone.utc) - timedelta(hours=2)
    with session_factory() as session:
        job = AnalysisJob(job_type="flood", status="QUEUED", input_scenes=[], parameters={}, created_at=old)
        session.add(job)
        session.commit()
        client = SimpleNamespace(exists=lambda key: False, llen=lambda key: backlog)
        recovered = reconcile_jobs(session, client)
        session.refresh(job)
        assert job.status == ("FAILED" if backlog == 0 else "QUEUED")
        assert bool(recovered["reconciled_job_ids"]) == (backlog == 0)