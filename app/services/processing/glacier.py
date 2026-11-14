import numpy as np

from app.services.processing.scientific_masks import common_shape


def glacier_offsets(along_track, slant_range, quality, glacier_mask, baseline_days, minimum_quality,
                    units, pixel_spacing_m=None):
    common_shape(along_track, slant_range, quality, glacier_mask)
    if not np.isfinite(baseline_days) or baseline_days <= 0:
        raise ValueError("A positive acquisition baseline in days is required")
    if units not in {"m", "meters", "metres", "pixels"}:
        raise ValueError("Offsets must declare supported physical units")
    if units == "pixels":
        if pixel_spacing_m is None or len(pixel_spacing_m) != 2 or any(not np.isfinite(value) or value <= 0 for value in pixel_spacing_m):
            raise ValueError("Pixel offsets require actual source along-track and slant-range pixel spacings, not output-grid spacing")
        along_track = along_track * pixel_spacing_m[0]
        slant_range = slant_range * pixel_spacing_m[1]
    valid = (np.isfinite(along_track) & np.isfinite(slant_range) & np.isfinite(quality)
             & (quality >= minimum_quality) & np.isfinite(glacier_mask) & (glacier_mask == 1))
    along = np.where(valid, along_track, np.nan).astype("float32")
    across = np.where(valid, slant_range, np.nan).astype("float32")
    return {"along_track_offset_m": along, "slant_range_offset_m": across,
            "radar_coordinate_magnitude_m": np.hypot(along, across),
            "radar_coordinate_rate_m_per_day": np.hypot(along, across) / baseline_days, "eligible": valid}