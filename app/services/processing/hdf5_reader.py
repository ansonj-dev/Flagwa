from dataclasses import dataclass

import h5py
import numpy as np
from pyproj import CRS
from rasterio.features import geometry_mask
from rasterio.transform import from_origin
from rasterio.warp import transform_geom
from shapely.geometry import shape

from app.core.config import get_settings
from app.core.exceptions import FlagwaError

DIAGONAL_TERMS = {"HHHH", "HVHV", "VVVV", "VHVH", "RHRH", "RVRV"}


@dataclass
class RasterLayer:
    data: np.ndarray
    crs: CRS
    transform: object
    quality: np.ndarray | None = None
    metadata: dict | None = None
    quality_values: np.ndarray | None = None


def json_value(value):
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, np.ndarray):
        return [json_value(item) for item in value.tolist()] if value.ndim else json_value(value.item())
    if isinstance(value, np.generic):
        return json_value(value.item())
    if isinstance(value, float) and not np.isfinite(value):
        return None
    return value if isinstance(value, (str, int, float, bool, type(None))) else str(value)


def inspect_product(path):
    datasets, groups, identification = [], [], {}
    with h5py.File(path, "r") as product:
        def visitor(name, obj):
            if isinstance(obj, h5py.Dataset):
                datasets.append({"path": "/" + name, "shape": list(obj.shape), "dtype": str(obj.dtype),
                                 "fill_value": json_value(obj.fillvalue),
                                 "attributes": {key: json_value(value) for key, value in obj.attrs.items()}})
                if "/identification/" in "/" + name and obj.size <= 20:
                    identification[name.rsplit("/", 1)[-1]] = json_value(obj[()])
            else:
                groups.append("/" + name)
        product.visititems(visitor)
    return {"groups": groups, "datasets": datasets, "identification": identification,
            "frequency_groups": [name for name in groups if name.rsplit("/", 1)[-1] in {"frequencyA", "frequencyB"}],
            "covariance_layers": [item["path"] for item in datasets if item["path"].rsplit("/", 1)[-1] in DIAGONAL_TERMS]}


def nearest_dataset(group, name):
    current = group
    while True:
        if name in current and isinstance(current[name], h5py.Dataset):
            return current[name]
        if current.name == "/":
            raise FlagwaError("HDF5_COORDINATES_MISSING", f"Required coordinate dataset {name} was not found", 422)
        current = current.parent


def read_gcov(path, aoi, term="HHHH", frequency_group="A", quality_valid_values=None):
    if term not in DIAGONAL_TERMS:
        raise FlagwaError("UNSUPPORTED_COVARIANCE", "Only real-valued diagonal GCOV power terms are supported", 422)
    inspection = inspect_product(path)
    matches = [item["path"] for item in inspection["datasets"] if
               item["path"].endswith(f"/frequency{frequency_group}/{term}") and "/GCOV/" in item["path"]]
    if len(matches) != 1:
        raise FlagwaError("HDF5_LAYER_UNAVAILABLE", "Selected GCOV frequency and covariance layer is absent or ambiguous", 422)
    with h5py.File(path, "r") as product:
        dataset = product[matches[0]]
        if dataset.ndim != 2 or dataset.dtype.kind != "f":
            raise FlagwaError("UNSUPPORTED_DATASET", "GCOV power must be a two-dimensional real floating-point layer", 422)
        group = dataset.parent
        coordinates_x = np.asarray(nearest_dataset(group, "xCoordinates")[()], dtype=float)
        coordinates_y = np.asarray(nearest_dataset(group, "yCoordinates")[()], dtype=float)
        if len(coordinates_x) < 2 or len(coordinates_y) < 2 or dataset.shape != (len(coordinates_y), len(coordinates_x)):
            raise FlagwaError("INVALID_GRID", "Coordinate vectors do not match the raster dimensions", 422)
        spacing_x, spacing_y = np.diff(coordinates_x), np.diff(coordinates_y)
        if not (np.allclose(spacing_x, spacing_x[0]) and np.allclose(spacing_y, spacing_y[0]) and spacing_x[0] > 0 and spacing_y[0] < 0):
            raise FlagwaError("UNSUPPORTED_GRID", "Expected regularly spaced eastward X and north-to-south Y coordinates", 422)
        crs = CRS.from_epsg(int(nearest_dataset(group, "projection")[()]))
        transformed_aoi = transform_geom("EPSG:4326", crs, aoi)
        west, south, east, north = shape(transformed_aoi).bounds
        dx, dy = spacing_x[0], -spacing_y[0]
        cols = np.flatnonzero((coordinates_x >= west - dx / 2) & (coordinates_x <= east + dx / 2))
        rows = np.flatnonzero((coordinates_y >= south - dy / 2) & (coordinates_y <= north + dy / 2))
        if not len(rows) or not len(cols):
            raise FlagwaError("NO_AOI_COVERAGE", "Selected raster does not intersect the study area", 422)
        height, width = rows[-1] - rows[0] + 1, cols[-1] - cols[0] + 1
        if height * width > get_settings().max_processing_pixels:
            raise FlagwaError("PROCESSING_LIMIT", "AOI exceeds configured raster pixel limit", 413)
        selection = np.s_[rows[0]:rows[-1] + 1, cols[0]:cols[-1] + 1]
        data = np.asarray(dataset[selection], dtype="float32")
        valid = np.isfinite(data) & (data > 0)
        for key in ["_FillValue", "missing_value"]:
            if key in dataset.attrs:
                valid &= data != dataset.attrs[key]
        units = json_value(dataset.attrs.get("units", "1"))
        if units not in {"1", "unitless", "unitless power", "linear", "linear power"}:
            raise FlagwaError("UNSUPPORTED_UNITS", "GCOV layer must be linear gamma-zero power, not dB or amplitude", 422)
        transform = from_origin(coordinates_x[cols[0]] - dx / 2, coordinates_y[rows[0]] + dy / 2, dx, dy)
        inside = geometry_mask([transformed_aoi], data.shape, transform, invert=True)
        data[~(valid & inside)] = np.nan
        quality = None
        quality_values = None
        if "mask" in group:
            if not quality_valid_values:
                raise FlagwaError("QUALITY_RULE_REQUIRED", "Provide reviewed valid mask codes from this product specification", 422)
            if group["mask"].shape != dataset.shape:
                raise FlagwaError("QUALITY_GRID_MISMATCH", "Quality mask dimensions do not match power raster", 422)
            quality_values = group["mask"][selection]
            quality = np.isin(quality_values, quality_valid_values) & inside
            data[~quality] = np.nan
        return RasterLayer(data, crs, transform, quality, {
            "dataset": matches[0], "units": "linear gamma-zero power", "source_units": units,
            "quality_mask_present": quality is not None, "quality_valid_values": quality_valid_values,
            "identification": inspection["identification"], "subset_shape": list(data.shape), "crs": crs.to_string(),
            "transform": list(transform)[:6],
        }, quality_values)