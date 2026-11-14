import numpy as np

from app.services.processing.scientific_masks import common_shape


def referenced_los(phase, coherence, components, wavelength_m, reference_pixel, minimum_coherence,
                   phase_to_range_sign, corrections=()):
    common_shape(phase, coherence, components, *corrections)
    if not np.isfinite(wavelength_m) or wavelength_m <= 0 or phase_to_range_sign not in {-1, 1}:
        raise ValueError("A measured wavelength and documented phase-to-range sign are required")
    if not 0 <= minimum_coherence <= 1:
        raise ValueError("Coherence threshold must be in [0, 1]")
    row, column = reference_pixel
    if not (0 <= row < phase.shape[0] and 0 <= column < phase.shape[1]):
        raise ValueError("Reference point is outside the selected raster")
    valid = (np.isfinite(phase) & np.isfinite(coherence) & (coherence >= minimum_coherence)
             & (coherence <= 1) & np.isfinite(components) & (components > 0))
    corrected = phase.astype("float64").copy()
    for correction in corrections:
        valid &= np.isfinite(correction)
        corrected -= correction
    if not valid[row, column]:
        raise ValueError("Reference point is not a coherent, valid connected-component sample")
    valid &= components == components[row, column]
    displacement = phase_to_range_sign * wavelength_m * (corrected - corrected[row, column]) / (4 * np.pi)
    return np.where(valid, displacement, np.nan).astype("float32")