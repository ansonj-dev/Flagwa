import json
import math
from pathlib import Path

import rasterio
from geoalchemy2.shape import from_shape
from rasterio.warp import transform_bounds
from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union
from sqlalchemy import select

from app.core.exceptions import FlagwaError
from app.models import ContextLayer, DataSource, Location
from app.models.entities import new_id
from app.services.nisar.scene_metadata import parse_datetime
from app.services.storage import get_storage

REFERENCES = {
    "population": ["WorldPop", "https://www.worldpop.org/", "GHSL", "https://human-settlement.emergency.copernicus.eu/"],
    "settlements": ["OpenStreetMap", "https://www.openstreetmap.org/copyright"],
    "infrastructure": ["OpenStreetMap", "https://www.openstreetmap.org/copyright"],
    "landcover": ["ESA WorldCover", "https://esa-worldcover.org/"],
    "permanent_water": ["JRC Global Surface Water", "https://global-surface-water.appspot.com/"],
    "hydrology": ["HydroSHEDS", "https://www.hydrosheds.org/"],
    "elevation": ["Copernicus DEM", "https://dataspace.copernicus.eu/"],
    "rainfall": ["NASA GPM IMERG", "https://gpm.nasa.gov/data/imerg"],
    "boundaries": ["geoBoundaries", "https://www.geoboundaries.org/"],
}


def register_context(session, source_path, registration, commit=True):
    location = session.scalar(select(Location).where(Location.slug == registration.location_slug))
    if not location:
        raise FlagwaError("LOCATION_NOT_FOUND", "Location was not found", 404)
    source_path = Path(source_path)
    metadata = registration.model_dump(mode="json")
    retrieved = parse_datetime(registration.retrieved_at)
    if retrieved is None:
        raise FlagwaError("INVALID_RETRIEVAL_DATE", "retrieved_at must be an ISO-8601 timestamp", 422)
    if source_path.suffix.lower() in {".json", ".geojson"}:
        collection = json.loads(source_path.read_text())
        if collection.get("type") != "FeatureCollection" or not collection.get("features") or registration.crs not in {"EPSG:4326", "OGC:CRS84"}:
            raise FlagwaError("INVALID_CONTEXT", "Vectors must be nonempty WGS84 GeoJSON FeatureCollections", 422)
        extent = unary_union([shape(feature["geometry"]) for feature in collection["features"]]).envelope
    else:
        with rasterio.open(source_path) as source:
            if not source.crs or source.crs.to_string() != registration.crs:
                raise FlagwaError("CONTEXT_CRS_MISMATCH", "Declared CRS must match the actual raster", 422)
            extent = box(*transform_bounds(source.crs, "EPSG:4326", *source.bounds))
            metadata["raster"] = {"resolution": list(source.res), "nodata": source.nodata if source.nodata is None or math.isfinite(source.nodata) else None,
                                  "nodata_is_nan": source.nodata is not None and math.isnan(source.nodata),
                                  "width": source.width, "height": source.height, "dtype": source.dtypes[0]}
    if not extent.is_valid or extent.is_empty:
        raise FlagwaError("INVALID_CONTEXT_EXTENT", "Context dataset has an invalid extent", 422)
    identifier = new_id()
    key = f"context/{identifier}/data{source_path.suffix.lower()}"
    get_storage().put_file(source_path, key)
    metadata["extent"] = mapping(extent)
    data_source = DataSource(name=registration.source, url=registration.source_url, license=registration.license,
                             version=registration.version, retrieved_at=retrieved, metadata_json=metadata)
    session.add(data_source)
    session.flush()
    layer = ContextLayer(id=identifier, location_id=location.id, data_source_id=data_source.id,
                         layer_type=registration.layer_type, source=registration.source, version=registration.version,
                         file_path=key, geometry=from_shape(extent, srid=4326), metadata_json=metadata)
    session.add(layer)
    session.commit() if commit else session.flush()
    return layer