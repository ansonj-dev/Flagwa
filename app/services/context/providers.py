import ipaddress
import json
import re
import socket
from urllib.parse import urljoin, urlsplit

import httpx
import osm2geojson
from shapely.geometry import mapping, shape
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.core.config import get_settings
from app.core.exceptions import FlagwaError

PUBLIC_HOSTS = {"overpass-api.de", "overpass.kumi.systems", "www.worldpop.org", "www.geoboundaries.org",
                "planetarycomputer.microsoft.com", "cmr.earthdata.nasa.gov", "github.com", "raw.githubusercontent.com", "media.githubusercontent.com"}


class TemporaryContextError(Exception):
    pass


def public_url(url, asset=False):
    parsed = urlsplit(url)
    hostname = parsed.hostname or ""
    allowed = hostname in PUBLIC_HOSTS or (asset and (hostname in {"data.worldpop.org", "data.worldpop.org.uk"} or hostname.endswith(".blob.core.windows.net")))
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443) or not allowed:
        raise FlagwaError("UNTRUSTED_CONTEXT_URL", "Context provider returned an unapproved destination", 502)
    try:
        addresses = socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(entry[4][0]).is_global for entry in addresses):
            raise ValueError()
    except (OSError, ValueError):
        raise FlagwaError("UNTRUSTED_CONTEXT_HOST", "Context destination does not resolve to public addresses", 502) from None
    return url


class ContextProviders:
    def __init__(self, client=None):
        self.client = client or httpx.Client(timeout=get_settings().provider_timeout_seconds, follow_redirects=False)

    @retry(retry=retry_if_exception_type((TemporaryContextError, httpx.TransportError)),
           wait=wait_exponential(multiplier=1, max=5), stop=stop_after_attempt(3), reraise=True)
    def _json(self, method, url, **kwargs):
        for redirect in range(5):
            public_url(url)
            with self.client.stream(method, url, **kwargs) as response:
                if response.is_redirect:
                    url = urljoin(url, response.headers.get("Location", ""))
                    if response.status_code == 303:
                        method, kwargs = "GET", {}
                    continue
                if response.status_code == 429 or response.status_code >= 500:
                    raise TemporaryContextError()
                if response.status_code != 200:
                    raise FlagwaError("CONTEXT_PROVIDER_REJECTED", "Context provider rejected the request", 502)
                body = bytearray()
                for chunk in response.iter_bytes(65536):
                    body.extend(chunk)
                    if len(body) > 32 * 1024 * 1024:
                        raise FlagwaError("CONTEXT_RESPONSE_LIMIT", "Context response exceeds the 32 MiB cap", 413)
                try:
                    return json.loads(body)
                except (ValueError, TypeError):
                    raise FlagwaError("CONTEXT_INVALID_RESPONSE", "Context provider did not return valid JSON", 502) from None
        raise FlagwaError("CONTEXT_REDIRECT_LIMIT", "Context redirect count exceeded the safety limit", 502)

    def json(self, method, url, **kwargs):
        try:
            return self._json(method, url, **kwargs)
        except (TemporaryContextError, httpx.TransportError):
            raise FlagwaError("CONTEXT_PROVIDER_UNAVAILABLE", "Context provider unavailable after bounded retries", 503) from None

    def osm(self, aoi, layer_type):
        polygon = shape(aoi)
        west, south, east, north = polygon.bounds
        if east - west > 1 or north - south > 1:
            raise FlagwaError("OSM_AOI_LIMIT", "OSM imports require a bounded study area no wider/taller than one degree", 413)
        filters = {"settlements": ['node["place"~"city|town|village|hamlet|isolated_dwelling"]'],
                   "infrastructure": ['way["highway"]', 'way["railway"]'],
                   "hydrology": ['way["waterway"]', 'way["natural"="water"]', 'relation["natural"="water"]', 'way["wetland"]']}
        if layer_type not in filters:
            raise FlagwaError("OSM_LAYER_UNSUPPORTED", "Choose settlements, infrastructure or hydrology", 422)
        bounds = f"({south},{west},{north},{east})"
        query = "[out:json][timeout:45][maxsize:67108864];(" + ";".join(item + bounds for item in filters[layer_type]) + ";);out body geom;"
        data = None
        endpoint = None
        for candidate in ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]:
            try:
                data = self.json("POST", candidate, data={"data": query})
                endpoint = candidate
                break
            except FlagwaError as error:
                if error.code not in {"CONTEXT_PROVIDER_REJECTED", "CONTEXT_PROVIDER_UNAVAILABLE"}:
                    raise
        if data is None:
            raise FlagwaError("OSM_UNAVAILABLE", "Both vetted public Overpass endpoints are unavailable; existing scientific processing remains independent", 503)
        if data.get("remark"):
            raise FlagwaError("OSM_INCOMPLETE_RESPONSE", "Overpass reported incomplete results; no partial layer was registered", 502)
        timestamp = data.get("osm3s", {}).get("timestamp_osm_base")
        if not timestamp:
            raise FlagwaError("OSM_VERSION_MISSING", "Overpass did not supply its snapshot timestamp", 502)
        collection = osm2geojson.json2geojson(data, log_level="ERROR", raise_on_failure=True)
        kept, rejected = [], 0
        for feature in collection.get("features", []):
            geometry = shape(feature["geometry"])
            if not geometry.is_valid:
                rejected += 1
                continue
            clipped = geometry.intersection(polygon)
            if not clipped.is_empty:
                kept.append(dict(feature, geometry=mapping(clipped)))
        if not kept:
            raise FlagwaError("CONTEXT_EMPTY", "No mapped OSM features matched; this is not proof that no features exist", 424)
        return {"type": "FeatureCollection", "features": kept}, {
            "source": "OpenStreetMap contributors", "source_url": "https://www.openstreetmap.org/copyright",
            "license": "Open Database License 1.0 (ODbL); OpenStreetMap attribution required", "version": timestamp,
            "provider_metadata": {"query": query, "endpoint": endpoint, "snapshot_timestamp": timestamp, "invalid_features_rejected": rejected,
                                  "limitations": "OSM is volunteered geographic data with incomplete and spatially variable coverage"}}

    def worldpop(self, country):
        if not re.fullmatch(r"[A-Z]{3}", country):
            raise FlagwaError("COUNTRY_CODE_INVALID", "Use an uppercase ISO alpha-3 country code", 422)
        data = self.json("GET", "https://www.worldpop.org/rest/data/pop/wpgp", params={"iso3": country})
        records = data.get("data")
        if not isinstance(records, list):
            raise FlagwaError("WORLDPOP_INVALID_RESPONSE", "WorldPop did not return its dataset inventory", 502)
        return [{"id": str(record["id"]) if record.get("id") is not None else None, "provider": "worldpop",
                 "title": record.get("title"), "source": "WorldPop", "source_url": "https://www.worldpop.org/",
                 "license": record.get("license"), "version": record.get("version"),
                 "assets": {f"file_{index}": {"href": href} for index, href in enumerate(record.get("files", [])) if isinstance(href, str)},
                 "metadata": record} for record in records]

    def planetary(self, provider, aoi):
        collection = {"worldcover": "esa-worldcover", "dem": "cop-dem-glo-30"}.get(provider)
        if not collection:
            raise FlagwaError("CONTEXT_PROVIDER_UNSUPPORTED", "Unknown Planetary Computer collection adapter", 422)
        base = "https://planetarycomputer.microsoft.com/api/stac/v1"
        descriptor = self.json("GET", f"{base}/collections/{collection}")
        data = self.json("POST", f"{base}/search", json={"collections": [collection], "intersects": aoi, "limit": 25})
        if not isinstance(data.get("features"), list):
            raise FlagwaError("STAC_CONTEXT_INVALID_RESPONSE", "STAC context search did not return items", 502)
        return [{"id": item.get("id"), "provider": provider, "source": descriptor.get("title") or collection,
                 "source_url": f"{base}/collections/{collection}", "license": descriptor.get("license"),
                 "version": item.get("properties", {}).get("version") or descriptor.get("version"),
                 "assets": item.get("assets", {}), "metadata": item.get("properties", {}), "geometry": item.get("geometry")}
                for item in data["features"]]

    def boundaries(self, country, level="ADM2"):
        if not re.fullmatch(r"[A-Z]{3}", country) or level not in {"ADM0", "ADM1", "ADM2"}:
            raise FlagwaError("BOUNDARY_QUERY_INVALID", "Use an ISO alpha-3 country and ADM0/ADM1/ADM2", 422)
        url = f"https://www.geoboundaries.org/api/current/gbOpen/{country}/{level}/"
        record = self.json("GET", url)
        return [{"id": record.get("boundaryID"), "provider": "boundaries", "source": "geoBoundaries gbOpen",
                 "source_url": url, "license": record.get("boundaryLicense"), "version": record.get("buildDate"),
                 "assets": {"geojson": {"href": record.get("simplifiedGeometryGeoJSON") or record.get("gjDownloadURL")}}, "metadata": record}]

    def rainfall(self, aoi, collection_id=None, start=None, end=None):
        collections = self.json("GET", "https://cmr.earthdata.nasa.gov/search/collections.json", params={"keyword": "GPM IMERG", "page_size": 100})
        records = collections.get("feed", {}).get("entry", [])
        if collection_id is None:
            return [{"id": record.get("id"), "provider": "rainfall", "title": record.get("title"),
                     "version": record.get("version_id"), "source_url": "https://gpm.nasa.gov/data/imerg", "metadata": record} for record in records]
        if collection_id not in {record.get("id") for record in records}:
            raise FlagwaError("IMERG_COLLECTION_UNKNOWN", "Choose a collection actually returned by IMERG discovery", 422)
        if not start or not end:
            raise FlagwaError("IMERG_DATES_REQUIRED", "Explicit temporal bounds are required for IMERG granule discovery", 422)
        params = {"collection_concept_id": collection_id, "bounding_box": ",".join(map(str, shape(aoi).bounds)),
                  "temporal": f"{start}/{end}", "page_size": 25}
        data = self.json("GET", "https://cmr.earthdata.nasa.gov/search/granules.umm_json", params=params)
        return [{"id": item.get("umm", {}).get("GranuleUR"), "provider": "rainfall", "source_url": "https://gpm.nasa.gov/data/imerg",
                 "metadata": item, "access": "GES DISC/Earthdata authorization and product-specific NetCDF processing may be required"} for item in data.get("items", [])]

    def close(self):
        self.client.close()