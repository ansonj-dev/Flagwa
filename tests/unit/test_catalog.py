from datetime import datetime, timezone

import httpx
import pytest
from pydantic import ValidationError
from shapely.geometry import box, mapping

from app.core.config import Settings
from app.core.exceptions import FlagwaError
from app.schemas.catalog import CatalogSearch
from app.services.nisar.asf_client import ASFClient
from app.services.nisar.bhoonidhi_client import BhoonidhiClient
from app.services.nisar.compatibility import compatibility
from app.services.nisar.earthdata_auth import EarthdataAuth
from app.services.nisar.scene_metadata import normalize_asf, public_metadata


@pytest.fixture
def synthetic_feature():
    return {"type": "Feature", "geometry": mapping(box(76, 9, 77, 10)), "properties": {
        "sceneName": "SYNTHETIC_BEFORE", "platform": "NISAR", "processingLevel": "GCOV",
        "dataMaturity": "VALIDATED", "startTime": "2026-10-22T00:00:00Z", "instrument": "LSAR",
        "mainBandPolarization": ["HH+HV"], "flightDirection": "ASCENDING", "pathNumber": 1,
        "frameNumber": 1, "lookDirection": "RIGHT", "rangeBandwidth": ["20+5"], "crid": "SYNTHETIC",
        "url": "https://example.invalid/not-a-real-product.h5"}}


def test_normalization_preserves_unknown_and_original(synthetic_feature):
    scene = normalize_asf(synthetic_feature)
    assert scene.frequency == "L"
    assert scene.polarizations == ["HH", "HV"]
    assert scene.metadata["original"] == synthetic_feature
    del synthetic_feature["properties"]["startTime"]
    assert normalize_asf(synthetic_feature).acquisition_datetime is None


def test_compatibility_conservative(synthetic_feature):
    before = normalize_asf(synthetic_feature)
    after = before.model_copy(deep=True, update={"scene_id": "SYNTHETIC_AFTER", "acquisition_datetime": datetime(2026, 11, 3, tzinfo=timezone.utc)})
    assert compatibility(before, after, synthetic_feature["geometry"])["compatible"]
    after.flight_direction = "DESCENDING"
    assert not compatibility(before, after, synthetic_feature["geometry"])["compatible"]
    after.flight_direction = before.flight_direction
    assert not compatibility(before, after, mapping(box(0, 0, 1, 1)))["compatible"]
    assert not compatibility(before, after, synthetic_feature["geometry"], "VVVV")["compatible"]
    after.frequency = None
    assert not compatibility(before, after, synthetic_feature["geometry"])["compatible"]


def test_query_rejects_invalid_polarization_and_geometry():
    kwargs = dict(start="2026-10-01T00:00:00Z", end="2026-11-01T00:00:00Z", bbox=(76, 9, 77, 10))
    assert CatalogSearch(**kwargs).aoi["type"] == "Polygon"
    for changes in [{"polarization": "WRONG"}, {"bbox": (77, 10, 76, 9)}, {"frequency": "S"}]:
        with pytest.raises(ValidationError):
            CatalogSearch(**(kwargs | changes))


def test_provider_failure_is_not_empty_success(monkeypatch):
    monkeypatch.setattr("asf_search.search", lambda **kwargs: (_ for _ in ()).throw(ConnectionError()))
    query = CatalogSearch(start="2026-10-01T00:00:00Z", end="2026-11-01T00:00:00Z", bbox=(76, 9, 77, 10))
    with pytest.raises(FlagwaError) as caught:
        ASFClient().search(query)
    assert caught.value.status in (502, 503)


def test_earthdata_missing_and_auth_failure(monkeypatch):
    monkeypatch.setattr("app.services.nisar.earthdata_auth.netrc_credentials", lambda: None)
    auth = EarthdataAuth(Settings(_env_file=None))
    assert not auth.status()["configured"]
    with pytest.raises(FlagwaError):
        auth.session()
    auth = EarthdataAuth(Settings(_env_file=None, earthdata_token="synthetic-secret"))
    monkeypatch.setattr("app.services.nisar.earthdata_auth.BoundedASFSession.auth_with_token", lambda *args: (_ for _ in ()).throw(ValueError("synthetic-secret")))
    with pytest.raises(FlagwaError) as caught:
        auth.session()
    assert "synthetic-secret" not in str(caught.value)


def test_public_metadata_removes_resource_urls():
    assert public_metadata({"url": "secret", "nested": {"token": "secret", "value": 1}}) == {"nested": {"value": 1}}
    reference = {"source_url": "https://example.invalid/public-source", "license": "Public reference: https://example.invalid/terms"}
    assert public_metadata(reference) == reference
    assert public_metadata({"source_url": "https://example.invalid/private?token=synthetic"}) == {}


def test_exact_asf_resolution_does_not_use_forbidden_max_results(monkeypatch, synthetic_feature):
    class Results:
        def raise_if_incomplete(self):
            pass

        def geojson(self):
            return {"features": [synthetic_feature]}

    def search(**kwargs):
        assert "maxResults" not in kwargs
        assert kwargs["granule_list"] == ["SYNTHETIC_BEFORE"]
        return Results()

    monkeypatch.setattr("asf_search.search", search)
    assert ASFClient().resolve("SYNTHETIC_BEFORE") == synthetic_feature


def test_bhoonidhi_disabled():
    with pytest.raises(FlagwaError) as caught:
        BhoonidhiClient(Settings(_env_file=None)).token()
    assert caught.value.code == "BHOONIDHI_DISABLED"


def test_bhoonidhi_refresh_cache_and_logout():
    calls = []

    def handler(request):
        calls.append(request)
        if request.url.path == "/auth/logout":
            return httpx.Response(200, json={})
        return httpx.Response(200, json={"access_token": "synthetic-access", "refresh_token": "synthetic-refresh", "expires_in": 1200})

    settings = Settings(_env_file=None, bhoonidhi_enabled=True, bhoonidhi_username="synthetic", bhoonidhi_password="synthetic")
    adapter = BhoonidhiClient(settings, httpx.Client(base_url=BhoonidhiClient.base, transport=httpx.MockTransport(handler)))
    assert adapter.token() == adapter.token()
    assert len(calls) == 1
    adapter.expires_at = 0
    adapter.token()
    assert b'"grant_type":"refresh_token"' in calls[-1].content
    adapter.logout()
    assert calls[-1].headers["authorization"] == "Bearer synthetic-refresh"
    assert adapter.access_token is None


def test_acquired_subset_must_include_selected_covariance_and_aoi(synthetic_feature):
    before = normalize_asf(synthetic_feature)
    before.geometry = mapping(box(75, 8, 78, 11))
    before.metadata["download"] = {"mode": "aoi_subset", "polarization": "HHHH", "frequency_group": "A", "aoi": synthetic_feature["geometry"]}
    after = before.model_copy(deep=True, update={"scene_id": "SYNTHETIC_AFTER", "acquisition_datetime": datetime(2026, 11, 3, tzinfo=timezone.utc)})
    assert compatibility(before, after, synthetic_feature["geometry"])["compatible"]
    assert not compatibility(before, after, synthetic_feature["geometry"], "HVHV")["compatible"]
    report = compatibility(before, after, mapping(box(75, 8, 78, 11)))
    assert any("Acquired subset" in message for message in report["blockers"])


def test_malformed_provider_geometry_is_unknown_not_fabricated(synthetic_feature):
    synthetic_feature["geometry"] = {"type": "Polygon", "coordinates": None}
    assert normalize_asf(synthetic_feature).geometry is None
    assert normalize_asf(synthetic_feature).metadata["original"]["geometry"] == synthetic_feature["geometry"]


def test_unknown_matching_maturity_is_still_not_compatible(synthetic_feature):
    before = normalize_asf(synthetic_feature)
    before.data_maturity = "UNKNOWN"
    after = before.model_copy(deep=True, update={"scene_id": "SYNTHETIC_AFTER", "acquisition_datetime": datetime(2026, 11, 3, tzinfo=timezone.utc)})
    assert not compatibility(before, after, synthetic_feature["geometry"])["compatible"]
    before.data_maturity = after.data_maturity = "VALIDATED"
    before.flight_direction = after.flight_direction = "UNKNOWN"
    assert not compatibility(before, after, synthetic_feature["geometry"])["compatible"]
    before.flight_direction = after.flight_direction = "ASCENDING"
    before.frequency = after.frequency = "UNKNOWN"
    assert not compatibility(before, after, synthetic_feature["geometry"])["compatible"]