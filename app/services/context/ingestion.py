import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit

import rasterio
from geoalchemy2.shape import to_shape
from rasterio.mask import mask
from rasterio.warp import transform_bounds, transform_geom
from rasterio.windows import from_bounds
from shapely.geometry import mapping, shape
from sqlalchemy import select

from app.core.config import get_settings
from app.core.exceptions import FlagwaError
from app.models import Location
from app.schemas.analysis import ContextRegistration
from app.services.context.providers import public_url
from app.services.context.registry import register_context


def import_osm(session, providers, location_slug, layer_type):
    location = session.scalar(select(Location).where(Location.slug == location_slug))
    if not location or location.geometry is None:
        raise FlagwaError("AOI_NOT_CONFIGURED", "A configured study polygon is required", 422)
    collection, provenance = providers.osm(mapping(to_shape(location.geometry)), layer_type)
    settings = get_settings()
    settings.local_storage_path.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=settings.local_storage_path, prefix="osm-") as directory:
        target = Path(directory) / "features.geojson"
        target.write_text(json.dumps(collection))
        registration = ContextRegistration(location_slug=location_slug, layer_type=layer_type, **provenance,
                                           retrieved_at=datetime.now(timezone.utc).isoformat(), crs="EPSG:4326", resolution="vector",
                                           units="features", processing_notes="Overpass snapshot clipped to the study polygon; mapping completeness is not guaranteed")
        return register_context(session, target, registration)


def import_discovered(session, providers, location_slug, item, asset_key, units, license_override=None, version_override=None):
    location = session.scalar(select(Location).where(Location.slug == location_slug))
    if not location or location.geometry is None:
        raise FlagwaError("AOI_NOT_CONFIGURED", "A configured study polygon is required", 422)
    asset = item.get("assets", {}).get(asset_key)
    if not item.get("id") or not asset or not asset.get("href"):
        raise FlagwaError("CONTEXT_ASSET_UNKNOWN", "Select an actual discovered item and asset key", 422)
    license_value, version = license_override or item.get("license"), version_override or item.get("version")
    if not license_value or license_value in {"various", "proprietary"} or not version:
        raise FlagwaError("CONTEXT_PROVENANCE_REQUIRED", "Actual version and reviewed license terms are required; supply overrides only from source documentation", 422)
    url = public_url(asset["href"], asset=True)
    layer_type = {"worldpop": "population", "worldcover": "landcover", "dem": "elevation", "boundaries": "boundaries"}.get(item["provider"])
    if not layer_type:
        raise FlagwaError("CONTEXT_IMPORT_UNSUPPORTED", "This discovery adapter requires product-specific offline ingestion", 422)
    if layer_type == "population" and units != "people/pixel":
        raise FlagwaError("CONTEXT_UNITS_UNSUPPORTED", "Population import requires verified count-per-pixel units, not density", 422)
    aoi = mapping(to_shape(location.geometry))
    settings = get_settings()
    settings.local_storage_path.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=settings.local_storage_path, prefix="context-") as directory:
        if layer_type == "boundaries":
            collection = providers.json("GET", url)
            polygon = shape(aoi)
            features = []
            for feature in collection.get("features", []):
                geometry = shape(feature["geometry"])
                if geometry.is_valid and geometry.intersects(polygon):
                    features.append(dict(feature, geometry=mapping(geometry.intersection(polygon))))
            if not features:
                raise FlagwaError("CONTEXT_EMPTY", "No boundary features intersect the study area", 424)
            target = Path(directory) / "boundaries.geojson"
            target.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
            crs, resolution = "EPSG:4326", "vector"
        else:
            if urlsplit(url).hostname.endswith(".blob.core.windows.net"):
                signed = providers.json("GET", "https://planetarycomputer.microsoft.com/api/sas/v1/sign", params={"href": url})
                signed_url = signed.get("href", "")
                if urlsplit(signed_url).hostname != urlsplit(url).hostname:
                    raise FlagwaError("UNTRUSTED_CONTEXT_URL", "Signed asset changed its storage host", 502)
                url = public_url(signed_url, asset=True)
            target = Path(directory) / "subset.tif"
            logging.getLogger("rasterio._env").setLevel(logging.CRITICAL)
            try:
                with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_TIMEOUT=60, GDAL_HTTP_MAX_RETRY=2):
                    with rasterio.open(url) as source:
                        if not source.crs:
                            raise FlagwaError("CONTEXT_CRS_MISSING", "Provider asset has no CRS", 422)
                        bounds = transform_bounds(4326, source.crs, *shape(aoi).bounds)
                        window = from_bounds(*bounds, source.transform)
                        if window.width * window.height > settings.max_processing_pixels:
                            raise FlagwaError("PROCESSING_LIMIT", "Context AOI exceeds the raster pixel budget", 413)
                        geometry = transform_geom(4326, source.crs, aoi)
                        data, transform = mask(source, [geometry], indexes=1, crop=True, filled=False)
                        profile = source.profile.copy()
                        profile.update(driver="GTiff", count=1, height=data.shape[0], width=data.shape[1], transform=transform,
                                       compress="DEFLATE", tiled=True)
                        nodata = source.nodata
                        if nodata is None and data.mask.any():
                            data = data.astype("float32")
                            nodata = float("nan")
                            profile.update(dtype="float32", nodata=nodata)
                        with rasterio.open(target, "w", **profile) as output:
                            output.write(data.filled(nodata if nodata is not None else 0), 1)
                        crs, resolution = source.crs.to_string(), str(source.res)
            except rasterio.errors.RasterioError:
                raise FlagwaError("CONTEXT_RASTER_UNAVAILABLE", "Provider raster could not be read; no private asset URL is logged", 502) from None
        registration = ContextRegistration(location_slug=location_slug, layer_type=layer_type, source=item["source"],
                                           source_url=item["source_url"], license=license_value, version=str(version),
                                           retrieved_at=datetime.now(timezone.utc).isoformat(), crs=crs, resolution=resolution, units=units,
                                           processing_notes="Actual provider asset subset to the configured AOI; original source units must be verified by the operator",
                                           provider_metadata={"provider": item["provider"], "item_id": item["id"], "asset_key": asset_key,
                                                              "asset_host": urlsplit(url).hostname, "original_metadata": item.get("metadata", {})})
        return register_context(session, target, registration)