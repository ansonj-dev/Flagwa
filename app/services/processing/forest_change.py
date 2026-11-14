import numpy as np

from app.services.processing.backscatter import calculate_backscatter_change
from app.services.processing.scientific_masks import common_shape, filtered_power, remove_small_components


def forest_candidates(before_co, after_co, before_cross, after_cross, forest_mask,
                      co_drop_db, cross_drop_db, kernel=3, minimum_pixels=4):
    common_shape(before_co, after_co, before_cross, after_cross, forest_mask)
    if co_drop_db >= 0 or cross_drop_db >= 0:
        raise ValueError("Forest candidate drops must be negative dB values")
    co_change = calculate_backscatter_change(filtered_power(before_co, kernel), filtered_power(after_co, kernel))
    cross_change = calculate_backscatter_change(filtered_power(before_cross, kernel), filtered_power(after_cross, kernel))
    valid = np.isfinite(co_change) & np.isfinite(cross_change) & np.isfinite(forest_mask)
    forest = valid & (forest_mask == 1)
    candidates = remove_small_components(forest & (co_change <= co_drop_db) & (cross_change <= cross_drop_db), minimum_pixels)
    classes = np.zeros(before_co.shape, dtype="uint8")
    classes[valid] = 1
    classes[forest & ((co_change <= co_drop_db) | (cross_change <= cross_drop_db))] = 4
    classes[candidates] = 3
    return classes, {"co_change_db": co_change, "cross_change_db": cross_change}