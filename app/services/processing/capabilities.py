from app.core.exceptions import FlagwaError

CAPABILITIES = {
    "flood": {"product": "GCOV", "status": "implemented_pending_scientific_validation", "method": "potential_inundation"},
    "forest": {"product": "GCOV", "status": "experimental_not_live_validated", "operational": False, "requires": "Dual polarization, forest mask and independent forest-loss/optical review"},
    "agriculture": {"product": "GCOV", "status": "experimental_not_live_validated", "operational": False, "requires": "At least three dated observations and agricultural land cover; descriptive response only"},
    "glacier": {"product": "GOFF", "status": "experimental_not_live_validated", "operational": False, "requires": "Actual offset units, quality, glacier mask and source acquisition dates"},
    "wildfire": {"product": "GCOV", "status": "experimental_not_live_validated", "operational": False, "requires": "Official fire perimeter, event date and independent optical burn mask"},
    "deformation": {"product": "GUNW", "status": "experimental_not_live_validated", "operational": False, "requires": "Phase units, measured frequency, coherence, connected components, reference and explicit correction assessment"},
}


def require_implementation(theme):
    if theme not in CAPABILITIES:
        raise FlagwaError("ANALYSIS_NOT_FOUND", "Unknown analysis theme", 404)
    if CAPABILITIES[theme]["status"] == "not_implemented":
        raise FlagwaError("SCIENTIFIC_MODULE_NOT_IMPLEMENTED", CAPABILITIES[theme]["requires"], 501)