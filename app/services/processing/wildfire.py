import numpy as np

from app.services.processing.backscatter import calculate_backscatter_change
from app.services.processing.scientific_masks import common_shape, filtered_power, remove_small_components


def wildfire_candidates(before_co, after_co, before_cross, after_cross, perimeter_mask,
                        optical_burn_mask, minimum_change_db, kernel=3, minimum_pixels=4):
    common_shape(before_co, after_co, before_cross, after_cross, perimeter_mask, optical_burn_mask)
    if minimum_change_db <= 0:
        raise ValueError("Minimum radar change magnitude must be positive")
    co_change = calculate_backscatter_change(filtered_power(before_co, kernel), filtered_power(after_co, kernel))
    cross_change = calculate_backscatter_change(filtered_power(before_cross, kernel), filtered_power(after_cross, kernel))
    magnitude = np.sqrt((co_change ** 2 + cross_change ** 2) / 2).astype("float32")
    valid = np.isfinite(magnitude) & np.isfinite(perimeter_mask) & np.isfinite(optical_burn_mask)
    inside = valid & (perimeter_mask == 1)
    radar_changed = magnitude >= minimum_change_db
    supported = inside & radar_changed & (optical_burn_mask == 1)
    candidates = remove_small_components(supported, minimum_pixels)
    classes = np.zeros(before_co.shape, dtype="uint8")
    classes[valid] = 1
    classes[inside & radar_changed] = 4
    classes[candidates] = 3
    magnitude[~valid] = np.nan
    return classes, {"radar_change_rms_db": magnitude, "co_change_db": co_change, "cross_change_db": cross_change}