import json
import shutil
from importlib.metadata import version
from pathlib import Path

import numpy as np
import psutil
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

from app.core.config import get_settings
from app.core.exceptions import FlagwaError
from app.schemas.analysis import FloodParameters
from app.services.processing.exports import write_cog, write_preview, write_vectors
from app.services.processing.flood_detection import CLASSES, classify_flood
from app.services.processing.hdf5_reader import read_gcov
from app.services.processing.raster_alignment import align_to, read_context_grid
from app.services.reporting.scientific_summary import scientific_summary


def process_flood(before_path, after_path, water_path, aoi, request, scenes, job_id, output_directory, progress, slope_path=None):
    settings = get_settings()
    output = Path(output_directory)
    output.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(output).free < settings.min_free_disk_bytes:
        raise FlagwaError("INSUFFICIENT_STORAGE", "Not enough space for processing outputs", 507)
    if psutil.virtual_memory().available < min(settings.max_processing_pixels * 64, 512_000_000):
        raise FlagwaError("INSUFFICIENT_MEMORY", "Processing memory budget is unavailable", 503)
    parameters = FloodParameters.model_validate(request["parameters"])
    options = dict(term=request["polarization"], frequency_group=request["frequency_group"], quality_valid_values=parameters.quality_valid_values)
    before = read_gcov(before_path, aoi, **options)
    progress(20)
    after = align_to(before, read_gcov(after_path, aoi, **options))
    progress(40)
    permanent_water = read_context_grid(water_path, before)
    slope = read_context_grid(slope_path, before, categorical=False) if slope_path else None
    classification, change = classify_flood(before.data, after.data, permanent_water, parameters, before.quality, after.quality, slope)
    if not np.any(classification):
        raise FlagwaError("NO_VALID_OBSERVATIONS", "No comparable valid pixels remain after quality and AOI masking", 422)
    if not before.crs.is_projected or before.crs.axis_info[0].unit_name.lower() not in {"metre", "meter"}:
        raise FlagwaError("AREA_CRS_UNSUPPORTED", "Candidate area statistics require a projected metric grid", 422)
    pixel_area = abs(before.transform.a * before.transform.e - before.transform.b * before.transform.d)
    statistics = {"class_pixel_counts": {label: int((classification == code).sum()) for code, label in CLASSES.items()},
                  "candidate_area_m2": float((classification == 3).sum() * pixel_area),
                  "area_method": "planar projected pixel count; not geodesically corrected",
                  "valid_change_pixels": int(np.isfinite(change).sum()), "change_units": "dB",
                  "mean_change_db": float(np.nanmean(change)), "min_change_db": float(np.nanmin(change)),
                  "max_change_db": float(np.nanmax(change)), "grid_crs": before.crs.to_string(),
                  "grid_resolution": [abs(before.transform.a), abs(before.transform.e)]}
    notes = ["Thresholds require independent local calibration and validation; outputs are candidates only.",
             "Flooded vegetation, wet paddy, wind, soil moisture and acquisition geometry can confound open-water thresholds.",
             "GCOV backscatter does not measure flood depth or ground displacement."]
    if request.get("_study_boundary", {}).get("status") != "reviewed":
        notes.append("Draft or unreviewed study boundary may not represent the official floodplain.")
    if before.quality is None or after.quality is None:
        notes.append("At least one product quality mask was missing; nonpermanent valid pixels are marked uncertain.")
    if slope is None:
        notes.append("No slope exclusion applied; terrain suitability has not been independently checked.")
    if any(scene.metadata.get("download", {}).get("mode") == "aoi_subset" for scene in scenes):
        notes.append("Measurements were acquired as authorized AOI derivatives, not complete multi-gigabyte source products.")
    metadata = {"analysis_id": job_id, "location": request["location_slug"], "analysis_type": "potential_inundation",
                "source_scenes": [scene.scene_id for scene in scenes], "processing_level": "GCOV",
                "data_maturity": [scene.data_maturity for scene in scenes], "polarization": request["polarization"],
                "frequency": scenes[0].frequency, "frequency_group": request["frequency_group"],
                "acquisition_dates": [scene.acquisition_datetime.isoformat() for scene in scenes],
                "algorithm_version": "flagwa-potential-inundation-0.1.0", "parameters": parameters.model_dump(),
                "software_versions": {name: version(name) for name in ["numpy", "rasterio", "h5py", "pyproj", "asf_search"]},
                "source_acquisitions": [{"scene_id": scene.scene_id, "acquisition": scene.metadata.get("download", {})} for scene in scenes],
                "synthetic": bool(request.get("_synthetic_context") or any(scene.metadata.get("synthetic_fixture") or scene.scene_id.startswith("SYNTHETIC") for scene in scenes)),
                "study_aoi": aoi, "study_boundary": request.get("_study_boundary", {"status": "draft_or_unreviewed"}),
                "validation_sources": [], "uncertainty_notes": notes, "result_status": "pending_validation",
                "class_legend": CLASSES, "processing_report": {"before": before.metadata, "after": after.metadata},
                "context_layers": {"permanent_water": request.get("permanent_water_layer_id"), "slope": request.get("slope_layer_id")}}
    progress(65)
    files = {"geotiff": output / "classification.tif", "change_geotiff": output / "change_db.tif",
             "geojson": output / "candidates.geojson", "preview": output / "preview.png",
             "summary": output / "summary.json", "report": output / "processing_report.json",
             "before_power": output / "before_power.tif", "after_power": output / "after_power.tif"}
    write_cog(files["geotiff"], classification, before, 0, categorical=True, units="class")
    write_cog(files["change_geotiff"], change, before, np.nan, units="dB")
    write_cog(files["before_power"], before.data, before, np.nan, units="1")
    write_cog(files["after_power"], after.data, before, np.nan, units="1")
    vectors = write_vectors(files["geojson"], classification, before, job_id)
    write_preview(files["preview"], classification)
    files["summary"].write_text(json.dumps(scientific_summary(metadata, statistics), indent=2))
    files["report"].write_text(json.dumps(metadata, indent=2))
    geometry = unary_union([shape(feature["geometry"]) for feature in vectors["features"]])
    progress(90)
    return {"files": files, "metadata": metadata, "statistics": statistics, "geometry": mapping(geometry)}