import numpy as np
from scipy.ndimage import label, uniform_filter


def common_shape(*arrays):
    if not arrays or any(array.shape != arrays[0].shape for array in arrays):
        raise ValueError("All input arrays must be aligned to the same grid")


def filtered_power(power, kernel):
    if kernel < 1 or kernel > 9 or kernel % 2 != 1:
        raise ValueError("Power averaging kernel must be an odd integer from 1 to 9")
    power = np.asarray(power, dtype="float32")
    valid = np.isfinite(power) & (power > 0)
    weights = uniform_filter(valid.astype("float32"), size=kernel, mode="constant")
    means = uniform_filter(np.where(valid, power, 0), size=kernel, mode="constant")
    output = np.full(power.shape, np.nan, dtype="float32")
    np.divide(means, weights, out=output, where=valid & (weights >= .75))
    return output


def remove_small_components(candidates, minimum):
    if minimum < 1:
        raise ValueError("Minimum component size must be positive")
    components, _ = label(candidates)
    counts = np.bincount(components.ravel())
    return candidates & (counts[components] >= minimum)