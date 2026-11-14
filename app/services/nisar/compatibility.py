from pyproj import Geod
from shapely.geometry import shape

from app.schemas.catalog import Scene
from app.services.nisar.scene_metadata import polarizations


def area(geometry):
    return abs(Geod(ellps="WGS84").geometry_area_perimeter(geometry)[0])


def compatibility(before: Scene, after: Scene, aoi: dict, term="HHHH", frequency_group="A"):
    blockers, warnings = [], []
    checks = {}
    allowed = {"product_type": {"GCOV", "GSLC", "GUNW", "GOFF", "SME2", "RSLC", "RIFG", "RUNW", "ROFF"},
               "frequency": {"L", "S"}, "flight_direction": {"ASCENDING", "DESCENDING"},
               "data_maturity": {"VALIDATED", "PROVISIONAL", "BETA"}}
    for field in ["product_type", "frequency", "flight_direction", "data_maturity"]:
        first, second = getattr(before, field), getattr(after, field)
        checks[field] = first in allowed[field] and second in allowed[field] and first == second
        if not checks[field]:
            blockers.append(f"Missing, unrecognized or different {field}")
    if before.data_maturity == "BETA":
        blockers.append("BETA products are not accepted for this analysis")
    elif before.data_maturity == "PROVISIONAL":
        warnings.append("Provisional input calibration has not been fully validated")
    elif before.data_maturity != "VALIDATED":
        blockers.append("Missing or unrecognized product maturity cannot authorize scientific analysis")
    if before.scene_id == after.scene_id or not before.acquisition_datetime or not after.acquisition_datetime:
        blockers.append("Two distinct scenes with known acquisition timestamps are required")
    elif before.acquisition_datetime >= after.acquisition_datetime:
        blockers.append("Before acquisition must precede after acquisition")
    for key in ["pathNumber", "frameNumber", "lookDirection", "rangeBandwidth"]:
        first, second = before.orbit_information.get(key), after.orbit_information.get(key)
        if first is None or second is None or first != second:
            blockers.append(f"Missing or incompatible observation geometry: {key}")
    if before.orbit_information.get("crid") != after.orbit_information.get("crid"):
        blockers.append("Processing release identifiers differ; baseline review is required")
    if not before.orbit_information.get("crid"):
        warnings.append("Processing release identifier is unavailable")
    for scene in (before, after):
        props = scene.metadata.get("original", {}).get("properties", {})
        available = scene.polarizations if frequency_group == "A" else polarizations(props.get("sideBandPolarization"))
        if term[:2] not in available:
            blockers.append(f"Selected diagonal covariance term is not supported by frequency {frequency_group} metadata")
        acquisition = scene.metadata.get("download", {})
        if acquisition.get("mode") == "aoi_subset":
            terms = acquisition.get("polarizations") or [acquisition.get("polarization")]
            if term not in terms or acquisition.get("frequency_group") != frequency_group:
                blockers.append("Requested frequency/covariance term is absent from the acquired subset; explicitly reacquire the required layers")
            try:
                coverage = area(shape(acquisition["aoi"]).intersection(shape(aoi))) / area(shape(aoi))
                if coverage < .98:
                    blockers.append("Acquired subset no longer covers the requested study AOI; explicit reacquisition is required")
            except (TypeError, KeyError, ValueError, ZeroDivisionError):
                blockers.append("Acquired subset coverage cannot be established from its provenance")
    try:
        study, first, second = shape(aoi), shape(before.geometry), shape(after.geometry)
        if not all(geom.is_valid and not geom.is_empty for geom in [study, first, second]):
            raise ValueError("Invalid footprint")
        common = first.intersection(second).intersection(study)
        ratio = area(common) / area(study)
        checks["common_aoi_coverage_fraction"] = ratio
        if ratio < 0.98:
            blockers.append("Common study-area coverage is below the required 98 percent")
    except (TypeError, KeyError, ValueError, ZeroDivisionError):
        blockers.append("Valid footprints and a nonempty study area are required")
    warnings.append("Catalogue compatibility is preliminary; HDF5 identity, grids and quality masks are checked by the worker")
    return {"compatible": not blockers, "blockers": sorted(set(blockers)), "warnings": warnings, "checks": checks}