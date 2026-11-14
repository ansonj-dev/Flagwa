from functools import lru_cache
from threading import RLock
from time import monotonic

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.core.config import get_settings
from app.core.exceptions import FlagwaError
from app.schemas.catalog import Scene
from app.services.nisar.scene_metadata import parse_datetime, polarizations


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
        if response.status_code in (401, 403):
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
                data = self._checked("POST", "/auth/token", json=payload).json()
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
            if error.code != "BHOONIDHI_NOT_AUTHORIZED":
                raise
            with self.lock:
                self.expires_at = 0
            return self._checked(method, path, headers={"Authorization": f"Bearer {self.token()}"}, **kwargs)

    def collections(self):
        return self.authorized("GET", "/data/collections").json()

    def search(self, query):
        collection_id = f"NISAR_SSAR_{query.product_type}"
        available = self.collections().get("collections", [])
        if collection_id not in [item.get("id") for item in available]:
            raise FlagwaError("BHOONIDHI_COLLECTION_UNAVAILABLE", "Requested NISAR collection is not in the authorized catalogue", 404)
        if query.offset:
            raise FlagwaError("BHOONIDHI_PAGINATION_UNSUPPORTED", "Use the authorized STAC adapter's next-page workflow; offset is ASF-only", 422)
        filters = [{"op": "eq", "args": [{"property": "Online"}, "Y"]}]
        if query.flight_direction:
            filters.append({"op": "eq", "args": [{"property": "Node"}, query.flight_direction]})
        if query.polarization or query.relative_orbit or query.frame or query.frame_coverage:
            raise FlagwaError("BHOONIDHI_FILTER_UNVERIFIED", "These filters require verification against live collection queryables", 422)
        payload = {"collections": [collection_id], "intersects": query.aoi,
                   "datetime": f"{query.start.isoformat()}/{query.end.isoformat()}", "limit": query.limit,
                   "filter": {"op": "and", "args": filters}, "filter-lang": "cql2-json"}
        data = self.authorized("POST", "/data/search", json=payload).json()
        scenes = []
        for feature in data.get("features", []):
            props = feature.get("properties", {})
            maturity = props.get("dataMaturity")
            if maturity != query.data_maturity:
                raise FlagwaError("BHOONIDHI_MATURITY_UNVERIFIED", "Returned items do not establish the requested maturity", 422)
            scenes.append(Scene(scene_id=feature["id"], source="BHOONIDHI", dataset="NISAR",
                                product_type=query.product_type, data_maturity=maturity, frequency="S",
                                acquisition_datetime=parse_datetime(props.get("datetime")), geometry=feature.get("geometry"),
                                polarizations=polarizations(props.get("Polarization")), flight_direction=props.get("Node"),
                                download_available=props.get("Online") == "Y", metadata={"original": feature}))
        return scenes, any(link.get("rel") == "next" for link in data.get("links", []))

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