import json

import numpy as np
import rasterio
from PIL import Image
from rasterio.features import shapes
from rasterio.shutil import copy as raster_copy
from rasterio.warp import transform_geom

from app.core.exceptions import FlagwaError


def write_cog(path, data, layer, nodata, categorical=False, units=None):
    temporary = path.with_suffix(".working.tif")
    try:
        with rasterio.open(temporary, "w", driver="GTiff", height=data.shape[0], width=data.shape[1],
                           count=1, dtype=str(data.dtype), crs=layer.crs, transform=layer.transform,
                           nodata=nodata, tiled=True, compress="DEFLATE") as output:
            output.write(data, 1)
            output.update_tags(AREA_OR_POINT="Area", scientific_status="pending_validation")
            output.set_band_description(1, path.stem)
            if units:
                output.set_band_unit(1, units)
        raster_copy(temporary, path, driver="COG", compress="DEFLATE", blocksize=256,
                    overview_resampling="NEAREST" if categorical else "AVERAGE")
        with rasterio.open(path) as check:
            if check.crs != layer.crs or check.shape != data.shape or check.tags(ns="IMAGE_STRUCTURE").get("LAYOUT") != "COG":
                raise FlagwaError("INVALID_OUTPUT", "Generated raster failed COG integrity checks", 500)
    finally:
        temporary.unlink(missing_ok=True)


def write_vectors(path, classification, layer, result_id, label="potential_new_inundation"):
    features = []
    for geometry, value in shapes(classification, mask=classification == 3, transform=layer.transform):
        if len(features) >= 100_000:
            raise FlagwaError("VECTOR_COMPLEXITY_LIMIT", "Candidate polygons exceed export complexity limit", 413)
        features.append({"type": "Feature", "geometry": transform_geom(layer.crs, "EPSG:4326", geometry),
                         "properties": {"class": label, "analysis_id": result_id,
                                        "validation_status": "pending_validation"}})
    collection = {"type": "FeatureCollection", "features": features}
    path.write_text(json.dumps(collection))
    return collection


def write_preview(path, classification):
    palette = np.array([[0, 0, 0, 0], [218, 224, 217, 255], [45, 112, 155, 255], [11, 187, 177, 255], [224, 172, 56, 255]], dtype="uint8")
    preview = Image.fromarray(palette[classification])
    preview.thumbnail((1200, 1200), Image.Resampling.NEAREST)
    preview.save(path, format="PNG")


def write_measurement_preview(path, data):
    valid = np.isfinite(data)
    if not valid.any():
        raise FlagwaError("NO_VALID_OBSERVATIONS", "No finite measurements remain for export", 422)
    lower, upper = float(data[valid].min()), float(data[valid].max())
    scaled = np.zeros(data.shape, dtype="float32")
    if upper > lower:
        scaled[valid] = (data[valid] - lower) / (upper - lower)
    rgba = np.zeros(data.shape + (4,), dtype="uint8")
    rgba[..., 0] = (scaled * 220 + 20).astype("uint8")
    rgba[..., 1] = ((1 - np.abs(scaled - .5) * 2) * 180 + 40).astype("uint8")
    rgba[..., 2] = ((1 - scaled) * 220 + 20).astype("uint8")
    rgba[..., 3] = valid.astype("uint8") * 255
    image = Image.fromarray(rgba)
    image.thumbnail((1200, 1200), Image.Resampling.NEAREST)
    image.save(path, format="PNG")
    return {"minimum": lower, "maximum": upper, "method": "linear display stretch only; not a classification threshold"}