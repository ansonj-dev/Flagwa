
import numpy as np
import rasterio
from pyproj import CRS, Transformer
from rasterio.mask import mask
from rasterio.warp import transform_geom
from shapely.geometry import box, shape
from shapely.ops import transform

from app.core.config import get_settings
from app.core.exceptions import FlagwaError


def vector_exposure(collection, change_geometry, distance_m=0):
    area = shape(change_geometry)
    if area.is_empty:
        return {"type": "FeatureCollection", "features": [], "method": "geometry intersection", "distance_m": distance_m}
    center = area.centroid
    local = CRS.from_proj4(f"+proj=aeqd +lat_0={center.y} +lon_0={center.x} +datum=WGS84 +units=m")
    project = Transformer.from_crs(4326, local, always_xy=True).transform
    query = transform(project, area).buffer(distance_m) if distance_m else area
    matches = []
    for feature in collection.get("features", []):
        geometry = shape(feature["geometry"])
        if not geometry.is_valid:
            raise FlagwaError("INVALID_CONTEXT_GEOMETRY", "Context dataset contains an invalid feature", 422)
        candidate = transform(project, geometry) if distance_m else geometry
        if candidate.intersects(query):
            matches.append(feature)
    return {"type": "FeatureCollection", "features": matches, "method": "local azimuthal-equidistant buffer intersection" if distance_m else "geometry intersection",
            "distance_m": distance_m, "limitations": ["Geographic exposure is not evidence of damage or people affected"]}


def raster_exposure(path, change_geometry, units, selected_classes=None):
    if units != "people/pixel" and not (units == "class" and selected_classes):
        raise FlagwaError("CONTEXT_UNITS_UNSUPPORTED", "Population requires people/pixel; categorical exposure requires class codes", 422)
    if shape(change_geometry).is_empty:
        return {"estimate": 0, "units": "people_geographically_exposed" if units == "people/pixel" else "pixels",
                "method": "empty candidate geometry", "valid_coverage_fraction": None,
                "limitations": ["No candidate area is not proof that no hazard or affected people exist"]}
    with rasterio.open(path) as source:
        if not source.crs:
            raise FlagwaError("CONTEXT_CRS_MISSING", "Context raster must have a CRS", 422)
        geometry = transform_geom(4326, source.crs, change_geometry)
        bounds = shape(geometry).bounds
        estimate_pixels = abs((bounds[2] - bounds[0]) * (bounds[3] - bounds[1]) / (source.transform.a * source.transform.e))
        if estimate_pixels > get_settings().max_processing_pixels:
            raise FlagwaError("EXPOSURE_LIMIT", "Exposure query exceeds raster allocation limit", 413)
        try:
            data, affine = mask(source, [geometry], indexes=1, crop=True, filled=False)
        except ValueError:
            raise FlagwaError("CONTEXT_NO_COVERAGE", "Context raster does not cover the requested geometry", 424) from None
        from rasterio.features import geometry_mask

        inside = geometry_mask([geometry], data.shape, affine, invert=True)
        valid = ~np.ma.getmaskarray(data) & np.isfinite(data.data) & inside
        query_area = shape(geometry)
        extent_fraction = min(1.0, query_area.intersection(box(*source.bounds)).area / query_area.area) if query_area.area else 0.0
        if units == "people/pixel":
            valid &= data.data >= 0
            result = float(np.sum(data.data[valid], dtype="float64"))
            method = "sum of nonnegative population counts for pixel centers inside the candidate geometry"
        elif units == "class" and selected_classes:
            result = int((valid & np.isin(data.data, selected_classes)).sum())
            method = "count of selected land-cover class pixel centers inside the candidate geometry"
        else:
            raise FlagwaError("CONTEXT_UNITS_UNSUPPORTED", "Population requires people/pixel; categorical exposure requires class codes", 422)
        coverage = float(valid.sum() / inside.sum()) * extent_fraction if inside.any() else 0.0
        return {"estimate": result, "units": "people_geographically_exposed" if units == "people/pixel" else "pixels",
                "method": method, "valid_coverage_fraction": coverage, "resolution": list(source.res),
            "extent_coverage_fraction": extent_fraction, "coverage_method": "planar extent intersection fraction times valid pixel-center fraction",
                "crs": source.crs.to_string(), "limitations": ["Pixel-center approximation; not a count of affected people", "No extrapolation across nodata or outside dataset extent"]}