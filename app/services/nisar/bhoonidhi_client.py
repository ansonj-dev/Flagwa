from functools import lru_cache
from threading import RLock
from time import monotonic
import json
from urllib.parse import quote, urljoin, urlsplit

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.core.config import get_settings
from app.core.exceptions import FlagwaError
from app.core.security import trusted_download_url
from app.schemas.catalog import Scene
from app.services.nisar.scene_metadata import footprint_geometry, parse_datetime, polarizations


class RetryableProviderError(Exception):
    pass


class BhoonidhiClient:
    base = "https://bhoonidhi-api.nrsc.gov.in"

    def __init__(self, settings=None, client=None):
        self.settings = settings or get_settings()
        self.client = client or httpx.Client(base_url=self.base, timeout=self.settings.provider_timeout_seconds, follow_redirects=False)
        self.access_token = None
        self.refresh_token = None
        self.expires_at = 0
        self.lock = RLock()

    @retry(retry=retry_if_exception_type((RetryableProviderError, httpx.TransportError)),
           stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8), reraise=True)
    def _request(self, method, path, **kwargs):
        response = self.client.request(method, path, **kwargs)
        if response.status_code == 429 or response.status_code >= 500:
            raise RetryableProviderError()
        return response

    def _checked(self, method, path, **kwargs):
        try:
            response = self._request(method, path, **kwargs)
        except (RetryableProviderError, httpx.TransportError):
            raise FlagwaError("BHOONIDHI_UNAVAILABLE", "Bhoonidhi unavailable or rate limited after bounded retries", 503) from None
        if response.status_code == 401:
            raise FlagwaError("BHOONIDHI_SESSION_EXPIRED", "Bhoonidhi session expired or credentials were rejected", 502)
        if response.status_code == 403:
            raise FlagwaError("BHOONIDHI_NOT_AUTHORIZED", "Bhoonidhi API access was not authorized", 502)
        if response.is_error or response.is_redirect:
            raise FlagwaError("BHOONIDHI_REQUEST_FAILED", "Bhoonidhi rejected the request", 502)
        return response

    def token(self):
        if not self.settings.bhoonidhi_enabled:
            raise FlagwaError("BHOONIDHI_DISABLED", "Bhoonidhi API access is disabled; NRSC authorization is required", 503)
        with self.lock:
            if self.access_token and monotonic() < self.expires_at:
                return self.access_token
            payload = {"userId": self.settings.bhoonidhi_username.get_secret_value()}
            if self.refresh_token:
                payload.update(grant_type="refresh_token", refresh_token=self.refresh_token)
            else:
                payload.update(grant_type="password", password=self.settings.bhoonidhi_password.get_secret_value())
            try:
                try:
                    response = self._checked("POST", "/auth/token", json=payload)
                except FlagwaError as error:
                    if error.code != "BHOONIDHI_SESSION_EXPIRED" or not self.refresh_token:
                        raise
                    self.refresh_token = None
                    response = self._checked("POST", "/auth/token", json={"userId": self.settings.bhoonidhi_username.get_secret_value(),
                                              "password": self.settings.bhoonidhi_password.get_secret_value(), "grant_type": "password"})
                data = response.json()
                self.access_token = data["access_token"]
                self.refresh_token = data["refresh_token"]
                self.expires_at = monotonic() + max(0, int(data["expires_in"]) - 60)
            except (KeyError, TypeError, ValueError):
                raise FlagwaError("BHOONIDHI_INVALID_RESPONSE", "Bhoonidhi returned an invalid token response", 502) from None
            return self.access_token

    def authorized(self, method, path, **kwargs):
        token = self.token()
        try:
            return self._checked(method, path, headers={"Authorization": f"Bearer {token}"}, **kwargs)
        except FlagwaError as error:
            if error.code != "BHOONIDHI_SESSION_EXPIRED":
                raise
            with self.lock:
                self.expires_at = 0
            return self._checked(method, path, headers={"Authorization": f"Bearer {self.token()}"}, **kwargs)

    def collections(self):
        return self.authorized("GET", "/data/collections").json()

    def item(self, collection_id, item_id):
        path = f"/data/collections/{quote(collection_id, safe='')}/items/{quote(item_id, safe='')}"
        data = self.authorized("GET", path).json()
        if data.get("id") != item_id or data.get("collection") != collection_id:
            raise FlagwaError("BHOONIDHI_ITEM_MISMATCH", "Returned STAC item identity differs from the requested product", 502)
        return data

    def next_page(self, link, original_payload):
        url = urlsplit(urljoin(self.base + "/data/search", link.get("href", "")))
        if url.scheme != "https" or url.hostname != "bhoonidhi-api.nrsc.gov.in" or url.port not in (None, 443) or url.username or url.password or url.path != "/data/search":
            raise FlagwaError("BHOONIDHI_UNTRUSTED_PAGE", "STAC pagination points outside the trusted search endpoint", 502)
        method = link.get("method", "GET").upper()
        if method not in {"GET", "POST"} or not isinstance(link.get("body", {}), dict):
            raise FlagwaError("BHOONIDHI_INVALID_PAGE", "Unsupported STAC next-link method or body", 502)
        body = link.get("body", original_payload)
        if link.get("merge"):
            body = original_payload | body
        path = url.path + ("?" + url.query if url.query else "")
        return method, path, {"json": body} if method == "POST" else {}

    def download_response(self, feature):
        item = self.item(feature["collection"], feature["id"])
        if item.get("properties", {}).get("Online") != "Y":
            raise FlagwaError("PRODUCT_OFFLINE", "Selected Bhoonidhi item is not available for online download", 409)
        request = self.client.build_request("GET", "/download", params={"id": item["id"], "collection": item["collection"]})
        url = str(request.url)
        for attempt in range(7):
            trusted_download_url(url, provider="BHOONIDHI")
            hostname = urlsplit(url).hostname
            headers = {"Authorization": f"Bearer {self.token()}"} if hostname == "bhoonidhi-api.nrsc.gov.in" else {}
            try:
                response = self.client.send(self.client.build_request("GET", url, headers=headers), stream=True, follow_redirects=False)
            except httpx.TransportError:
                raise FlagwaError("BHOONIDHI_DOWNLOAD_FAILED", "Bhoonidhi streaming connection failed", 502) from None
            if response.status_code == 401 and hostname == "bhoonidhi-api.nrsc.gov.in" and attempt == 0:
                response.close()
                self.expires_at = 0
                continue
            if response.is_redirect:
                url = urljoin(url, response.headers.get("Location", ""))
                response.close()
                continue
            if response.status_code != 200:
                response.close()
                raise FlagwaError("BHOONIDHI_DOWNLOAD_FAILED", "Bhoonidhi product transfer was rejected or rate limited", 502)
            return response
        raise FlagwaError("PROVIDER_REDIRECT_LIMIT", "Bhoonidhi download exceeded its redirect/re-authentication limit", 502)

    def search(self, query):
        collection_id = f"NISAR_SSAR_{query.product_type}"
        available = self.collections().get("collections", [])
        if collection_id not in [item.get("id") for item in available]:
            raise FlagwaError("BHOONIDHI_COLLECTION_UNAVAILABLE", "Requested NISAR collection is not in the authorized catalogue", 404)
        filters = [{"op": "eq", "args": [{"property": "Online"}, "Y"]}]
        if query.flight_direction:
            filters.append({"op": "eq", "args": [{"property": "Node"}, query.flight_direction]})
        if query.polarization or query.relative_orbit or query.frame or query.frame_coverage:
            raise FlagwaError("BHOONIDHI_FILTER_UNVERIFIED", "These filters require verification against live collection queryables", 422)
        payload = {"collections": [collection_id], "intersects": query.aoi,
                   "datetime": f"{query.start.isoformat()}/{query.end.isoformat()}", "limit": min(100, query.offset + query.limit + 1),
                   "filter": {"op": "and", "args": filters}, "filter-lang": "cql2-json"}
        features, seen = [], set()
        method, path, arguments = "POST", "/data/search", {"json": payload}
        has_next = False
        for page in range(32):
            signature = json.dumps([method, path, arguments], sort_keys=True)
            if signature in seen:
                raise FlagwaError("BHOONIDHI_PAGINATION_LOOP", "Provider repeated a STAC pagination link", 502)
            seen.add(signature)
            data = self.authorized(method, path, **arguments).json()
            if not isinstance(data.get("features"), list):
                raise FlagwaError("BHOONIDHI_INVALID_RESPONSE", "STAC search returned no feature array", 502)
            features.extend(data["features"])
            next_link = next((link for link in data.get("links", []) if link.get("rel") == "next"), None)
            has_next = next_link is not None
            if len(features) > query.offset + query.limit or not next_link:
                break
            method, path, arguments = self.next_page(next_link, payload)
        else:
            raise FlagwaError("BHOONIDHI_PAGINATION_LIMIT", "Provider page count exceeded the bounded search limit", 502)
        scenes = []
        for feature in features[query.offset:query.offset + query.limit]:
            props = feature.get("properties", {})
            maturity = props.get("dataMaturity")
            if query.data_maturity is not None and maturity != query.data_maturity:
                raise FlagwaError("BHOONIDHI_MATURITY_UNVERIFIED", "Returned items do not establish the requested maturity", 422)
            scenes.append(Scene(scene_id=feature["id"], source="BHOONIDHI", dataset="NISAR",
                                product_type=query.product_type, data_maturity=maturity, frequency="S",
                                acquisition_datetime=parse_datetime(props.get("datetime")), geometry=footprint_geometry(feature.get("geometry")),
                                polarizations=polarizations(props.get("Polarization")), flight_direction=props.get("Node"),
                                download_available=props.get("Online") == "Y", metadata={"original": feature}))
        return scenes, has_next or len(features) > query.offset + query.limit

    def logout(self):
        try:
            if self.refresh_token:
                self._checked("POST", "/auth/logout", headers={"Authorization": f"Bearer {self.refresh_token}"})
        finally:
            self.access_token = self.refresh_token = None
            self.expires_at = 0


@lru_cache
def bhoonidhi_client():
    return BhoonidhiClient()