import numpy as np

from app.services.processing.backscatter import power_to_db


def agricultural_response(observations, dates, agriculture_mask, minimum_observations=3, minimum_span_days=24):
    if len(observations) != len(dates) or len(dates) < minimum_observations:
        raise ValueError("A dated time series with enough observations is required")
    if any(first >= second for first, second in zip(dates, dates[1:])):
        raise ValueError("Acquisition dates must be strictly increasing and distinct")
    days = np.array([(date - dates[0]).total_seconds() / 86400 for date in dates], dtype="float64")
    if days[-1] < minimum_span_days:
        raise ValueError("Acquisition time span is too short for the requested descriptive analysis")
    if any(observation.shape != agriculture_mask.shape for observation in observations):
        raise ValueError("Agricultural observations and context must use a common grid")
    stack = np.stack([power_to_db(observation) for observation in observations])
    valid = np.isfinite(stack)
    counts = valid.sum(axis=0)
    totals = np.where(valid, stack, 0).astype("float64")
    times = days.reshape((-1,) + (1,) * agriculture_mask.ndim)
    sum_time = np.where(valid, times, 0).sum(axis=0)
    sum_value = totals.sum(axis=0)
    denominator = counts * np.where(valid, times ** 2, 0).sum(axis=0) - sum_time ** 2
    eligible = (counts >= minimum_observations) & np.isfinite(agriculture_mask) & (agriculture_mask == 1) & (denominator > 0)
    first_day = np.min(np.where(valid, times, np.inf), axis=0)
    last_day = np.max(np.where(valid, times, -np.inf), axis=0)
    eligible &= last_day - first_day >= minimum_span_days
    trend = np.full(agriculture_mask.shape, np.nan, dtype="float32")
    numerator = counts * (totals * times).sum(axis=0) - sum_time * sum_value
    np.divide(numerator, denominator, out=trend, where=eligible)
    mean = np.divide(sum_value, counts, out=np.zeros_like(sum_value), where=counts > 0)
    variance = np.divide(np.where(valid, (stack - mean) ** 2, 0).sum(axis=0), counts,
                         out=np.zeros_like(sum_value), where=counts > 0)
    spread = np.max(np.where(valid, stack, -np.inf), axis=0) - np.min(np.where(valid, stack, np.inf), axis=0)
    deviation = np.where(eligible, np.sqrt(variance), np.nan).astype("float32")
    spread = np.where(eligible, spread, np.nan).astype("float32")
    return {"trend_db_per_day": trend, "temporal_std_db": deviation, "temporal_range_db": spread,
            "observation_count": counts.astype("float32"), "eligible": eligible}