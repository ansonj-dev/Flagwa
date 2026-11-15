import httpx
import pytest
from shapely.geometry import box, mapping

from app.core.exceptions import FlagwaError
from app.cli.fetch_draft_aoi import select_feature
from app.services.context.providers import ContextProviders


@pytest.fixture
def trusted_mock(monkeypatch):
    monkeypatch.setattr("app.services.context.providers.public_url", lambda url, **kwargs: url)


def test_osm_uses_real_geometry_converter_and_snapshot_metadata(trusted_mock):
    raw = {"version": .6, "osm3s": {"timestamp_osm_base": "2026-11-14T00:00:00Z"}, "elements": [
        {"type": "node", "id": 1, "lat": 9.3, "lon": 76.4, "tags": {"place": "village", "name": "SYNTHETIC FIXTURE ONLY"}},
        {"type": "node", "id": 2, "lat": 8, "lon": 75, "tags": {"place": "village"}},
    ]}
    client = ContextProviders(httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=raw))))
    collection, provenance = client.osm(mapping(box(76.25, 9.2, 76.55, 9.5)), "settlements")
    assert len(collection["features"]) == 1
    assert provenance["version"] == raw["osm3s"]["timestamp_osm_base"]
    assert "ODbL" in provenance["license"]


def test_worldpop_unknown_units_and_version_are_not_invented(trusted_mock):
    response = {"data": [{"id": "SYNTHETIC", "title": "SYNTHETIC population fixture", "files": ["https://data.worldpop.org/synthetic.tif"]}]}
    client = ContextProviders(httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=response))))
    items = client.worldpop("IND")
    assert items[0]["id"] == "SYNTHETIC"
    assert items[0]["version"] is None
    assert items[0]["license"] is None
    assert "units" not in items[0]


def test_stac_uses_actual_item_assets_and_collection_license(trusted_mock):
    def handler(request):
        if request.method == "GET":
            return httpx.Response(200, json={"title": "SYNTHETIC collection", "license": "SYNTHETIC test terms", "version": "synthetic"})
        return httpx.Response(200, json={"features": [{"id": "SYNTHETIC_ITEM", "assets": {"map": {"href": "https://example.invalid/synthetic.tif"}}, "properties": {}}]})

    client = ContextProviders(httpx.Client(transport=httpx.MockTransport(handler)))
    items = client.planetary("worldcover", mapping(box(76, 9, 77, 10)))
    assert items[0]["id"] == "SYNTHETIC_ITEM"
    assert items[0]["assets"]["map"]["href"].endswith("synthetic.tif")


def test_geo_boundaries_supports_adm3_and_keeps_source_metadata(trusted_mock):
    record = {"boundaryID": "ITA-ADM3", "boundaryLicense": "CC-BY-3.0", "buildDate": "2023-12-12",
              "simplifiedGeometryGeoJSON": "https://www.geoboundaries.org/ita-adm3.geojson"}
    client = ContextProviders(httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=record))))
    item = client.boundaries("ITA", "ADM3")[0]
    assert item["id"] == "ITA-ADM3"
    assert item["license"] == "CC-BY-3.0"
    assert item["version"] == "2023-12-12"
    assert item["assets"]["geojson"]["href"].endswith("ita-adm3.geojson")


def test_provider_failure_is_not_an_empty_context_layer(trusted_mock):
    client = ContextProviders(httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(403))))
    with pytest.raises(FlagwaError) as caught:
        client.worldpop("IND")
    assert caught.value.code == "CONTEXT_PROVIDER_REJECTED"


def test_json_response_limit_is_bounded_and_configurable(trusted_mock):
    content = b'{"value":"' + b'a' * 80 + b'"}'
    client = ContextProviders(httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, content=content))))
    assert client.json("GET", "https://example.invalid/source", response_limit_bytes=128)["value"] == "a" * 80
    with pytest.raises(FlagwaError) as caught:
        client.json("GET", "https://example.invalid/source", response_limit_bytes=64)
    assert caught.value.code == "CONTEXT_RESPONSE_LIMIT"
    with pytest.raises(FlagwaError) as caught:
        client.json("GET", "https://example.invalid/source", response_limit_bytes=65 * 1024 * 1024)
    assert caught.value.code == "CONTEXT_RESPONSE_LIMIT_INVALID"


def test_osm_unavailable_endpoints_are_reported_not_fabricated(trusted_mock):
    calls = []
    client = ContextProviders(httpx.Client(transport=httpx.MockTransport(lambda request: calls.append(request) or httpx.Response(403))))
    with pytest.raises(FlagwaError) as caught:
        client.osm(mapping(box(76.25, 9.2, 76.55, 9.5)), "settlements")
    assert caught.value.code == "OSM_UNAVAILABLE"
    assert len(calls) == 2


def test_source_boundary_selection_requires_one_exact_feature():
    collection = {"features": [
        {"id": "feature-1", "properties": {"shapeName": "North Region"}},
        {"id": "feature-2", "properties": {"shapeName": "South Region"}},
        {"id": "feature-3", "properties": {"shapeName": "South Region"}},
    ]}
    assert select_feature(collection, feature_name="north region")["id"] == "feature-1"
    assert select_feature(collection, feature_id="feature-2")["id"] == "feature-2"
    with pytest.raises(FlagwaError) as caught:
        select_feature(collection, feature_name="south region")
    assert caught.value.code == "BOUNDARY_SELECTION_REQUIRED"