from app.core.exceptions import FlagwaError

CAPABILITIES = {
    "flood": {"product": "GCOV", "status": "implemented_pending_scientific_validation", "method": "potential_inundation"},
    "forest": {"product": "GCOV", "status": "not_implemented", "requires": "Forest mask, temporal model, independent forest-loss validation"},
    "agriculture": {"product": "GCOV", "status": "not_implemented", "requires": "Seasonal time series, land cover, rainfall; SME2 maturity verification for soil moisture"},
    "glacier": {"product": "GOFF", "status": "not_implemented", "requires": "Offsets, units, quality flags and movement-reference validation"},
    "wildfire": {"product": "GCOV", "status": "not_implemented", "requires": "Official fire perimeter and independent optical burn validation"},
    "deformation": {"product": "GUNW", "status": "not_implemented", "requires": "Coherence, unwrap quality, reference, atmosphere, orbital correction and LOS geometry"},
}


def require_implementation(theme):
    if theme not in CAPABILITIES:
        raise FlagwaError("ANALYSIS_NOT_FOUND", "Unknown analysis theme", 404)
    if CAPABILITIES[theme]["status"] == "not_implemented":
        raise FlagwaError("SCIENTIFIC_MODULE_NOT_IMPLEMENTED", CAPABILITIES[theme]["requires"], 501)