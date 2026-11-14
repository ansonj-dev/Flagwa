import json

import httpx
import pytest

from app.core.config import Settings
from app.core.exceptions import FlagwaError
from app.schemas.catalog import CatalogSearch
from app.services.nisar.bhoonidhi_client import BhoonidhiClient


def adapter(handler):
    settings = Settings(_env_file=None, bhoonidhi_enabled=True, bhoonidhi_username="synthetic", bhoonidhi_password="synthetic")
    client = BhoonidhiClient(settings, httpx.Client(base_url=BhoonidhiClient.base, transport=httpx.MockTransport(handler)))
    client.access_token = "synthetic-access"
    client.refresh_token = "synthetic-refresh"
    client.expires_at = float("inf")
    return client


def test_stac_pagination_offset_and_has_more():
    calls = []

    def handler(request):
        calls.append(request)
        if request.url.path.endswith("collections"):
            return httpx.Response(200, json={"collections": [{"id": "NISAR_SSAR_GCOV"}]})
        page = request.url.params.get("page", "1")
        identifiers = ["SYNTHETIC_1", "SYNTHETIC_2"] if page == "1" else ["SYNTHETIC_3", "SYNTHETIC_4"]
        return httpx.Response(200, json={"features": [{"id": identifier, "collection": "NISAR_SSAR_GCOV", "geometry": None,
            "properties": {"dataMaturity": "VALIDATED", "Online": "Y"}} for identifier in identifiers],
            "links": [{"rel": "next", "href": "/data/search?page=2"}] if page == "1" else []})

    query = CatalogSearch(provider="BHOONIDHI", frequency="S", bbox=(76, 9, 77, 10), start="2026-10-01T00:00:00Z", end="2026-11-01T00:00:00Z", limit=2, offset=1)
    scenes, more = adapter(handler).search(query)
    assert [scene.scene_id for scene in scenes] == ["SYNTHETIC_2", "SYNTHETIC_3"]
    assert more
    assert len(calls) == 3


def test_untrusted_stac_next_link_is_never_requested():
    client = adapter(lambda request: httpx.Response(200))
    with pytest.raises(FlagwaError) as caught:
        client.next_page({"href": "https://evil.invalid/data/search", "rel": "next"}, {})
    assert caught.value.code == "BHOONIDHI_UNTRUSTED_PAGE"


def test_expired_refresh_token_falls_back_once_to_credentials():
    grants = []

    def handler(request):
        grant = json.loads(request.content)["grant_type"]
        grants.append(grant)
        if grant == "refresh_token":
            return httpx.Response(401)
        return httpx.Response(200, json={"access_token": "synthetic-new", "refresh_token": "synthetic-next", "expires_in": 1200})

    client = adapter(handler)
    client.expires_at = 0
    assert client.token() == "synthetic-new"
    assert grants == ["refresh_token", "password"]


def test_forbidden_requests_do_not_reauthenticate():
    calls = []
    client = adapter(lambda request: calls.append(request) or httpx.Response(403))
    with pytest.raises(FlagwaError) as caught:
        client.collections()
    assert caught.value.code == "BHOONIDHI_NOT_AUTHORIZED"
    assert len(calls) == 1


def test_download_refreshes_item_metadata_and_streams(monkeypatch):
    monkeypatch.setattr("app.services.nisar.bhoonidhi_client.trusted_download_url", lambda url, **kwargs: url)

    def handler(request):
        if request.url.path.startswith("/data/collections/"):
            return httpx.Response(200, json={"id": "SYNTHETIC", "collection": "NISAR_SSAR_GCOV", "properties": {"Online": "Y"}})
        assert request.url.path == "/download"
        return httpx.Response(200, content=b"SYNTHETIC streaming fixture")

    response = adapter(handler).download_response({"id": "SYNTHETIC", "collection": "NISAR_SSAR_GCOV"})
    try:
        assert b"".join(response.iter_bytes()) == b"SYNTHETIC streaming fixture"
    finally:
        response.close()


def test_unknown_maturity_discovery_is_explicit_and_not_invented():
    def handler(request):
        if request.url.path.endswith("collections"):
            return httpx.Response(200, json={"collections": [{"id": "NISAR_SSAR_GCOV"}]})
        return httpx.Response(200, json={"features": [{"id": "SYNTHETIC_UNKNOWN_MATURITY", "properties": {"Polarization": "DH"}}], "links": []})

    query = CatalogSearch(provider="BHOONIDHI", frequency="S", data_maturity=None, bbox=(76, 9, 77, 10),
                          start="2026-10-01T00:00:00Z", end="2026-11-01T00:00:00Z")
    scenes, more = adapter(handler).search(query)
    assert scenes[0].data_maturity is None
    assert scenes[0].polarizations == ["HH", "HV"]
    assert not more