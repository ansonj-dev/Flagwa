import numpy as np


def power_to_db(power):
    power = np.asarray(power, dtype="float32")
    valid = np.isfinite(power) & (power > 0)
    output = np.full(power.shape, np.nan, dtype="float32")
    output[valid] = 10.0 * np.log10(power[valid])
    return output


def calculate_backscatter_change(before, after):
    if np.shape(before) != np.shape(after):
        raise ValueError("Backscatter arrays must already be on the same grid")
    return power_to_db(after) - power_to_db(before)