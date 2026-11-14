import numpy as np

from app.services.processing.backscatter import calculate_backscatter_change, power_to_db

CLASSES = {0: "invalid_observation", 1: "no_candidate_detected", 2: "permanent_water", 3: "potential_new_inundation", 4: "uncertain"}


def classify_flood(before, after, permanent_water, parameters, before_quality=None, after_quality=None, slope=None):
    if before.shape != after.shape or before.shape != permanent_water.shape:
        raise ValueError("Power rasters and permanent-water mask must share a common grid")
    valid = np.isfinite(before) & np.isfinite(after) & (before > 0) & (after > 0)
    quality_known = before_quality is not None and after_quality is not None
    if quality_known:
        if before_quality.shape != before.shape or after_quality.shape != before.shape:
            raise ValueError("Quality masks must match the aligned raster grid")
        valid &= before_quality & after_quality
    change = calculate_backscatter_change(before, after)
    after_db, before_db = power_to_db(after), power_to_db(before)
    known_water = np.isfinite(permanent_water)
    permanent = known_water & np.isin(permanent_water, parameters.permanent_water_values)
    output = np.zeros(before.shape, dtype="uint8")
    output[valid] = 1
    output[valid & permanent] = 2
    ambiguous = (change <= parameters.change_db_max) | (after_db <= parameters.after_db_max)
    output[valid & ~permanent & ambiguous] = 4
    candidates = valid & known_water & ~permanent & (before_db >= parameters.before_db_min) & (after_db <= parameters.after_db_max) & (change <= parameters.change_db_max)
    if slope is not None:
        candidates &= np.isfinite(slope) & (slope <= parameters.max_slope_degrees)
    if quality_known:
        output[candidates] = 3
    else:
        output[valid & ~permanent] = 4
    output[valid & ~known_water] = 4
    change[~valid] = np.nan
    return output, change