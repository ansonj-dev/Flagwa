import json
import shutil
from pathlib import Path
from pathlib import PurePosixPath

import numpy as np
import psutil
from pyproj import Transformer
from rasterio.features import rasterize
from rasterio.transform import rowcol
from rasterio.warp import transform_geom
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

from app.core.config import get_settings
from app.core.exceptions import FlagwaError
from app.services.nisar.scene_metadata import parse_datetime
from app.services.processing.agriculture import agricultural_response
from app.services.processing.deformation import referenced_los
from app.services.processing.exports import write_cog, write_measurement_preview, write_preview, write_vectors
from app.services.processing.forest_change import forest_candidates
from app.services.processing.glacier import glacier_offsets
from app.services.processing.hdf5_reader import read_gcov, read_geocoded, scalar_value
from app.services.processing.raster_alignment import align_to, read_context_grid
from app.services.processing.wildfire import wildfire_candidates
from app.services.validation import binary_metrics

METHODS = {
    "forest": ("forest_disturbance_candidates", "class"),
    "wildfire": ("fire_associated_radar_optical_candidates", "class"),
    "agriculture": ("agricultural_temporal_surface_response", "dB/day"),
    "glacier": ("glacier_radar_coordinate_offset_rate", "m/day"),
    "deformation": ("apparent_relative_los_displacement", "m"),
}


def compatible_measurement_groups(*paths):
    frequency_groups, polarizations = set(), set()
    for path in paths:
        for part in PurePosixPath(path).parts:
            if part in {"frequencyA", "frequencyB"}:
                frequency_groups.add(part)
            if part in {"HH", "HV", "VV", "VH", "RH", "RV"}:
                polarizations.add(part)
    if len(frequency_groups) > 1 or len(polarizations) > 1:
        raise FlagwaError("INCOMPATIBLE_MEASUREMENT_GROUPS", "Selected measurement and quality layers mix frequency groups or polarizations", 422)


def context_mask(path, reference, classes=(1,)):
    path = Path(path)
    if path.suffix.lower() in {".json", ".geojson"}:
        collection = json.loads(path.read_text())
        if len(collection.get("features", [])) > 100000:
            raise FlagwaError("CONTEXT_COMPLEXITY_LIMIT", "Context vector exceeds the feature limit", 413)
        geometries = []
        for feature in collection.get("features", []):
            geometry = shape(feature["geometry"])
            if not geometry.is_valid or geometry.geom_type not in {"Polygon", "MultiPolygon"}:
                raise FlagwaError("INVALID_CONTEXT_GEOMETRY", "A polygon context layer is required", 422)
            geometries.append((transform_geom(4326, reference.crs, mapping(geometry)), 1))
        return rasterize(geometries, out_shape=reference.data.shape, transform=reference.transform, fill=0).astype("float32") if geometries else np.zeros(reference.data.shape, dtype="float32")
    data = read_context_grid(path, reference)
    return np.where(np.isfinite(data), np.isin(data, classes).astype("float32"), np.nan)


def resource_budget(output, pixels, observation_count):
    settings = get_settings()
    Path(output).mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(output).free < settings.min_free_disk_bytes + pixels * 32:
        raise FlagwaError("INSUFFICIENT_STORAGE", "Advanced processing requires more staging disk", 507)
    if psutil.virtual_memory().available < pixels * max(128, observation_count * 48):
        raise FlagwaError("INSUFFICIENT_MEMORY", "Reduce the AOI/time-series size or increase worker memory", 503)


def product_dates(identification):
    first = parse_datetime(identification.get("referenceZeroDopplerStartTime"))
    second = parse_datetime(identification.get("secondaryZeroDopplerStartTime"))
    if first is None or second is None or first >= second:
        raise FlagwaError("PRODUCT_DATES_REQUIRED", "Actual reference and secondary acquisition timestamps must be present in HDF5 identification", 422)
    return first, second


def check_identity(layer, scene):
    identity = (layer.metadata or {}).get("identification", {})
    if identity.get("granuleId") != scene.scene_id or identity.get("productType") != scene.product_type:
        raise FlagwaError("PRODUCT_IDENTITY_MISMATCH", "Actual HDF5 identity and product type must match the selected catalogue scene", 422)
    if identity.get("hasInputDataException") not in (None, 0, False, "False") or identity.get("diagnosticModeFlag") not in (None, 0):
        raise FlagwaError("PRODUCT_QUALITY_REVIEW_REQUIRED", "Product reports input-data exceptions or diagnostic acquisition mode", 422)
    return identity


def process_advanced(theme, paths, context_paths, aoi, request, scenes, job_id, output_directory, progress):
    output = Path(output_directory)
    parameters = request["parameters"]
    reports, notes = [], ["Experimental scientific implementation; independent real-data validation remains pending."]
    supporting_evidence = {}
    dates = [scene.acquisition_datetime for scene in scenes]
    if theme in {"forest", "wildfire", "agriculture"}:
        options = {"term": request["polarization"], "frequency_group": request["frequency_group"],
                   "quality_valid_values": parameters["quality_valid_values"]}
        reference = read_gcov(paths[0], aoi, **options)
        resource_budget(output, reference.data.size, len(paths))

        def load(index, term):
            layer = reference if index == 0 and term == request["polarization"] else read_gcov(paths[index], aoi, **(options | {"term": term}))
            check_identity(layer, scenes[index])
            if layer.quality is None:
                raise FlagwaError("QUALITY_MASK_REQUIRED", "Advanced GCOV analysis requires explicit actual product quality masks", 422)
            reports.append(layer.metadata)
            return layer if layer is reference else align_to(reference, layer)

        observations = [load(index, request["polarization"]).data for index in range(len(paths))]
        progress(30)
        if theme == "agriculture":
            mask = context_mask(context_paths["landcover"], reference, request["agriculture_classes"])
            layers = agricultural_response(observations, dates, mask, parameters["minimum_observations"], parameters["minimum_span_days"])
            eligible = layers.pop("eligible")
            primary = layers["trend_db_per_day"]
            classification = np.where(eligible, 3, 0).astype("uint8")
            notes.extend(["Temporal trend, range and variability are descriptive, not crop yield, drought attribution or soil moisture.",
                          "No annual seasonal model is inferred from a short observation series; rainfall context does not establish causation."])
        else:
            before_cross, after_cross = load(0, request["cross_polarization"]).data, load(1, request["cross_polarization"]).data
            if theme == "forest":
                mask = context_mask(context_paths["landcover"], reference, request["forest_classes"])
                classification, layers = forest_candidates(*observations, before_cross, after_cross, mask,
                    parameters["co_drop_db"], parameters["cross_drop_db"], parameters["smoothing_kernel"], parameters["minimum_component_pixels"])
                notes.append("Forest disturbance candidates are not deforestation; phenology, moisture and independent forest-loss/optical evidence require review.")
                if "forest_loss" in context_paths:
                    observed = context_mask(context_paths["forest_loss"], reference, request["forest_loss_positive_values"])
                    supporting_evidence["forest_loss_agreement"] = binary_metrics(classification, observed, [1])
                    notes.append("Supporting forest-loss agreement does not establish temporal suitability or grant independent scientific approval.")
            else:
                perimeter = context_mask(context_paths["fire_perimeter"], reference)
                optical = context_mask(context_paths["optical_burn"], reference)
                classification, layers = wildfire_candidates(*observations, before_cross, after_cross, perimeter, optical,
                    parameters["minimum_change_db"], parameters["smoothing_kernel"], parameters["minimum_component_pixels"])
                notes.append("Agreement with a supplied perimeter and optical mask is supporting evidence, not validated burn severity or proof all radar changes were caused by fire.")
            primary = classification
    else:
        if theme == "glacier":
            paths_to_check = [request[key] for key in ["along_track_dataset", "slant_range_dataset", "quality_dataset"]]
            compatible_measurement_groups(*paths_to_check)
            if len({str(PurePosixPath(path).parent) for path in paths_to_check}) != 1:
                raise FlagwaError("INCOMPATIBLE_OFFSET_LAYERS", "Offsets and quality must come from the same GOFF estimator layer", 422)
            reference = read_geocoded(paths[0], aoi, request["along_track_dataset"], {"m", "meters", "metres", "meter", "metre", "pixels", "pixel"})
        else:
            compatible_measurement_groups(*(request[key] for key in ["phase_dataset", "coherence_dataset", "connected_components_dataset", "center_frequency_dataset"]))
            reference = read_geocoded(paths[0], aoi, request["phase_dataset"], {"radians", "radian", "rad"})
        identity = check_identity(reference, scenes[0])
        dates = list(product_dates(identity))
        resource_budget(output, reference.data.size, 1)
        reports.append(reference.metadata)
        if theme == "glacier":
            across = read_geocoded(paths[0], aoi, request["slant_range_dataset"], {"m", "meters", "metres", "meter", "metre", "pixels", "pixel"})
            quality = read_geocoded(paths[0], aoi, request["quality_dataset"], {"1", "unitless"} if parameters["quality_metric"] == "correlation" else {"1", "unitless", "db"})
            quality_data = align_to(reference, quality).data
            if parameters["quality_metric"] == "correlation":
                quality_data = np.where((quality_data >= 0) & (quality_data <= 1), quality_data, np.nan)
            source_units = "pixels" if reference.metadata["units"] in {"pixels", "pixel"} else "m"
            across_units = "pixels" if across.metadata["units"] in {"pixels", "pixel"} else "m"
            if source_units != across_units:
                raise FlagwaError("OFFSET_UNIT_MISMATCH", "Along-track and slant-range offset units differ", 422)
            spacing = None
            if source_units == "pixels":
                if not parameters.get("pixel_spacing_source"):
                    raise FlagwaError("SOURCE_SPACING_REQUIRED", "Document the actual source pixel spacings, not output-grid resolution", 422)
                spacing = (parameters.get("along_track_pixel_spacing_m"), parameters.get("slant_range_pixel_spacing_m"))
                if any(value is None for value in spacing):
                    raise FlagwaError("SOURCE_SPACING_REQUIRED", "Both source pixel spacings are required for pixel-valued offsets", 422)
            glacier = context_mask(context_paths["glacier_extent"], reference, request["glacier_classes"])
            layers = glacier_offsets(reference.data, align_to(reference, across).data, quality_data, glacier,
                                      (dates[1] - dates[0]).total_seconds() / 86400, parameters["minimum_quality"], source_units, spacing)
            eligible = layers.pop("eligible")
            primary = layers["radar_coordinate_rate_m_per_day"]
            classification = np.where(eligible, 3, 0).astype("uint8")
            notes.append("Along-track/slant-range rate is not map-horizontal glacier speed or a full three-dimensional motion vector. Outlier review and independent movement validation are required.")
            reports.extend([across.metadata, quality.metadata])
        else:
            coherence = read_geocoded(paths[0], aoi, request["coherence_dataset"], {"1", "unitless"})
            components = read_geocoded(paths[0], aoi, request["connected_components_dataset"], {"1", "unitless"})
            frequency = scalar_value(paths[0], request["center_frequency_dataset"], {"hz", "hertz"})
            band_limits = {"L": (1e9, 2e9), "S": (2e9, 4e9)}
            limits = band_limits.get(scenes[0].frequency)
            if limits is None or not limits[0] <= frequency <= limits[1]:
                raise FlagwaError("INVALID_RADAR_FREQUENCY", "Measured center frequency is inconsistent with the catalogue radar band", 422)
            transformer = Transformer.from_crs(4326, reference.crs, always_xy=True)
            coordinates = transformer.transform(*parameters["reference_point"])
            pixel = rowcol(reference.transform, *coordinates)
            corrections = [read_context_grid(path, reference, categorical=False) for role, path in context_paths.items() if role.startswith("phase_correction:")]
            primary = referenced_los(reference.data, align_to(reference, coherence).data, align_to(reference, components, categorical=True).data,
                                     299792458.0 / frequency, pixel, parameters["minimum_coherence"], parameters["phase_to_range_sign"], corrections)
            layers = {"apparent_relative_los_m": primary}
            classification = np.where(np.isfinite(primary), 3, 0).astype("uint8")
            notes.extend(["Referenced apparent LOS change is not vertical subsidence, three-dimensional ground movement or a deformation time series.",
                          "Only supplied radian correction grids are subtracted. Atmospheric, orbital, tidal, unwrapping and reference errors remain unless independently assessed; no correction is inferred from GCOV."])
            reports.extend([coherence.metadata, components.metadata, {"center_frequency_hz": frequency, "wavelength_m": 299792458.0 / frequency}])
        progress(50)
    if not np.isfinite(primary).any() or not (classification > 0).any():
        raise FlagwaError("NO_VALID_OBSERVATIONS", "No valid measurements remain after theme-specific quality and context filters", 422)
    result_type, units = METHODS[theme]
    categorical = theme in {"forest", "wildfire"}
    finite = np.isfinite(primary) & (classification > 0)
    statistics = {"valid_pixels": int(finite.sum()), "units": units, "grid_crs": reference.crs.to_string(),
                  "grid_resolution": [abs(reference.transform.a), abs(reference.transform.e)]}
    if supporting_evidence:
        statistics["supporting_evidence"] = supporting_evidence
    if categorical:
        if not reference.crs.is_projected or reference.crs.axis_info[0].unit_name.lower() not in {"metre", "meter"}:
            raise FlagwaError("AREA_CRS_UNSUPPORTED", "Candidate areas require a projected metric grid", 422)
        statistics.update(candidate_pixels=int((classification == 3).sum()), candidate_area_m2=float((classification == 3).sum() * abs(reference.transform.a * reference.transform.e)),
                          area_method="planar projected pixel area", uncertain_pixels=int((classification == 4).sum()))
    else:
        statistics.update(minimum=float(primary[finite].min()), maximum=float(primary[finite].max()), mean=float(primary[finite].mean()))
    metadata = {"analysis_id": job_id, "location": request["location_slug"], "analysis_type": result_type,
                "source_scenes": [scene.scene_id for scene in scenes], "processing_level": scenes[0].product_type,
                "data_maturity": [scene.data_maturity for scene in scenes], "frequency": scenes[0].frequency,
                "polarization": request.get("polarization"), "frequency_group": request.get("frequency_group"),
                "acquisition_dates": [date.isoformat() for date in dates], "algorithm_version": f"flagwa-{theme}-0.1.0",
                "parameters": request, "processing_report": reports, "validation_sources": [], "uncertainty_notes": notes,
                "result_status": "pending_validation", "operational": False, "units": units,
                "synthetic": bool(request.get("_synthetic_context") or any(scene.metadata.get("synthetic_fixture") or scene.scene_id.startswith("SYNTHETIC") for scene in scenes)),
                "geometry_semantics": "candidate_change_area" if categorical else "measurement_coverage_not_impact_area"}
    metadata.update(study_aoi=aoi, study_boundary=request.get("_study_boundary", {"status": "draft_or_unreviewed"}),
                    source_acquisitions=[{"scene_id": scene.scene_id, "acquisition": scene.metadata.get("download", {})} for scene in scenes])
    files = {"geotiff": output / "result.tif", "geojson": output / "coverage.geojson", "preview": output / "preview.png",
             "summary": output / "summary.json", "report": output / "processing_report.json"}
    write_cog(files["geotiff"], primary, reference, 0 if categorical else np.nan, categorical, units=units)
    vectors = write_vectors(files["geojson"], classification, reference, job_id, result_type if categorical else "measurement_coverage")
    if categorical:
        write_preview(files["preview"], classification)
        metadata["class_legend"] = {0: "invalid", 1: "no_candidate", 3: result_type, 4: "uncertain"}
    else:
        metadata["preview_scale"] = write_measurement_preview(files["preview"], primary)
    for name, data in layers.items():
        if name not in {"eligible"}:
            path = output / f"{name}.tif"
            layer_units = "dB/day" if name.endswith("db_per_day") else "m/day" if name.endswith("m_per_day") else "dB" if name.endswith("_db") else "m" if name.endswith("_m") else "count"
            write_cog(path, data.astype("float32"), reference, np.nan, units=layer_units)
            files[name] = path
    files["summary"].write_text(json.dumps({"title": result_type, "analysis_id": job_id, "statistics": statistics,
                                           "synthetic": metadata["synthetic"],
                                           "validation_status": "pending_validation", "source_scenes": metadata["source_scenes"],
                                           "acquisition_dates": metadata["acquisition_dates"], "uncertainty_notes": notes}, indent=2))
    files["report"].write_text(json.dumps(metadata, indent=2))
    progress(90)
    return {"files": files, "metadata": metadata, "statistics": statistics,
            "geometry": mapping(unary_union([shape(feature["geometry"]) for feature in vectors["features"]]))}