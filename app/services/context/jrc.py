import math
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

import httpx
import numpy as np
import rasterio
from geoalchemy2.shape import to_shape
from rasterio.mask import mask
from shapely.geometry import mapping
from sqlalchemy import select

from app.core.config import get_settings
from app.core.exceptions import FlagwaError
from app.models import Location
from app.schemas.analysis import ContextRegistration
from app.services.context.registry import register_context

BASE_URL = "https://storage.googleapis.com/global-surface-water/downloads2021/seasonality/"


def tile_name(bounds):
    west, south, east, north = bounds
    left = math.floor(west / 10) * 10
    top = math.floor(north / 10) * 10 + 10
    if east > left + 10 or south < top - 10:
        raise FlagwaError("JRC_MULTI_TILE_UNSUPPORTED", "This importer requires the AOI to fit a single JRC 10-degree tile", 422)
    longitude = f"{abs(left)}{'E' if left >= 0 else 'W'}"
    latitude = f"{abs(top)}{'N' if top >= 0 else 'S'}"
    return f"seasonality_{longitude}_{latitude}v1_4_2021.tif"


def seasonality_to_permanent(values, valid):
    result = np.full(values.shape, 255, dtype="uint8")
    known = valid & (values >= 0) & (values <= 12)
    result[known] = (values[known] == 12).astype("uint8")
    return result


def import_jrc_water(session, location_slug):
    location = session.scalar(select(Location).where(Location.slug == location_slug))
    if not location or location.geometry is None:
        raise FlagwaError("AOI_NOT_CONFIGURED", "A study-area polygon is required for JRC import", 422)
    geometry = to_shape(location.geometry)
    name = tile_name(geometry.bounds)
    settings = get_settings()
    settings.local_storage_path.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix="jrc-", dir=settings.local_storage_path) as temporary:
        directory = Path(temporary)
        source_path = directory / name
        size = 0
        try:
            with httpx.stream("GET", BASE_URL + name, timeout=settings.provider_timeout_seconds, follow_redirects=False) as response:
                if response.status_code != 200:
                    raise FlagwaError("JRC_UNAVAILABLE", "Official JRC tile was unavailable; no replacement data were generated", 502)
                with source_path.open("wb") as output:
                    for chunk in response.iter_bytes(1024 * 1024):
                        size += len(chunk)
                        if size > 32 * 1024 * 1024:
                            raise FlagwaError("JRC_TRANSFER_LIMIT", "Official tile exceeded the importer's 32 MiB cap", 413)
                        output.write(chunk)
        except httpx.HTTPError:
            raise FlagwaError("JRC_UNAVAILABLE", "Official JRC tile download failed", 502) from None
        target = directory / "permanent_water_2021.tif"
        with rasterio.open(source_path) as source:
            from rasterio.windows import from_bounds

            if source.crs.to_epsg() != 4326:
                raise FlagwaError("JRC_CRS_CHANGED", "Unexpected official JRC raster CRS; importer review required", 422)
            window = from_bounds(*geometry.bounds, source.transform)
            if window.width * window.height > settings.max_processing_pixels:
                raise FlagwaError("PROCESSING_LIMIT", "JRC AOI exceeds the raster allocation limit", 413)
            data, transform = mask(source, [mapping(geometry)], crop=True, indexes=1, filled=False)
            permanent = seasonality_to_permanent(data.data, ~np.ma.getmaskarray(data))
            with rasterio.open(target, "w", driver="GTiff", height=permanent.shape[0], width=permanent.shape[1], count=1,
                               dtype="uint8", crs=source.crs, transform=transform, nodata=255, tiled=True, compress="DEFLATE") as output:
                output.write(permanent, 1)
                output.update_tags(source="JRC Global Surface Water v1.4 seasonality 2021", derivation="12 months water = 1; other known values = 0; nodata = 255")
            resolution = str(source.res)
        registration = ContextRegistration(location_slug=location_slug, layer_type="permanent_water",
                                           source="EC JRC / Google Global Surface Water", source_url=BASE_URL + name,
                                           license="JRC Global Surface Water data reuse terms; attribution required; https://global-surface-water.appspot.com/download",
                                           version="GSW-v1.4-seasonality-2021-derived-12-month-water", retrieved_at=datetime.now(timezone.utc).isoformat(),
                                           crs="EPSG:4326", resolution=resolution, units="class",
                                           processing_notes="Historical 2021 seasonality baseline, not current flood validation. 12 water months -> 1; other valid months -> 0; nodata -> 255. Shoreline/land-use changes since 2021 remain a limitation.")
        return register_context(session, target, registration)