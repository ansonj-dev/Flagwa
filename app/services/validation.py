import hashlib

import numpy as np
import rasterio

from app.core.config import get_settings
from app.core.exceptions import FlagwaError
from app.models import AnalysisJob, ContextLayer
from app.models.entities import new_id, utcnow
from app.schemas.analysis import ValidationEvidence
from app.services.nisar.scene_metadata import parse_datetime
from app.services.processing.hdf5_reader import RasterLayer
from app.services.processing.raster_alignment import read_context_grid
from app.services.storage import get_storage

TARGETS = {"potential_inundation", "forest_disturbance_candidates", "fire_associated_radar_optical_candidates"}


def uses_synthetic_inputs(result, reference):
    return bool(result.metadata_json.get("synthetic") or reference.metadata_json.get("is_synthetic")
                or any(identifier.startswith("SYNTHETIC") for identifier in result.metadata_json.get("source_scenes", [])))


def binary_metrics(classification, reference, positive_values):
    if classification.shape != reference.shape:
        raise ValueError("Validation rasters must be aligned")
    domain = classification > 0
    valid = domain & (classification != 4) & np.isfinite(reference)
    predicted = classification == 3
    observed = np.isin(reference, positive_values)
    true_positive = int((valid & predicted & observed).sum())
    false_positive = int((valid & predicted & ~observed).sum())
    false_negative = int((valid & ~predicted & observed).sum())
    true_negative = int((valid & ~predicted & ~observed).sum())

    def ratio(numerator, denominator):
        return numerator / denominator if denominator else None

    return {"true_positive": true_positive, "false_positive": false_positive, "false_negative": false_negative,
            "true_negative": true_negative, "valid_pixels": int(valid.sum()),
            "reference_positive_pixels": true_positive + false_negative,
            "coverage_fraction": ratio(int(valid.sum()), int(domain.sum())) or 0,
            "precision": ratio(true_positive, true_positive + false_positive),
            "recall": ratio(true_positive, true_positive + false_negative),
            "iou": ratio(true_positive, true_positive + false_positive + false_negative),
            "method": "nearest-grid binary pixel agreement; uncertain/nodata excluded, uncertainty penalizes coverage"}


def validation_reference(session, result, payload):
    if result.result_type not in TARGETS:
        raise FlagwaError("VALIDATION_METHOD_UNSUPPORTED", "This assessment evaluates binary candidates, not continuous motion or temporal trends", 422)
    source_job = session.get(AnalysisJob, result.analysis_job_id)
    reference = session.get(ContextLayer, payload.reference_layer_id)
    if (not reference or reference.location_id != source_job.location_id or reference.layer_type != "independent_validation"
            or reference.metadata_json.get("units") != "class" or reference.file_path == result.output_path):
        raise FlagwaError("VALIDATION_REFERENCE_REQUIRED", "A separate study-area independent-validation class raster is required", 422)
    evidence = reference.metadata_json.get("validation_evidence")
    if not evidence:
        raise FlagwaError("VALIDATION_PROVENANCE_REQUIRED", "Register reference sensor, target, observation date, independence and mapping method", 422)
    evidence = ValidationEvidence.model_validate(evidence)
    if evidence.target != result.result_type or not evidence.independent_of_nisar or "nisar" in evidence.sensor.lower():
        raise FlagwaError("REFERENCE_NOT_INDEPENDENT", "Reference must independently measure the same target", 422)
    used = set(source_job.parameters.get("context_layers", {}).values())
    used.update(source_job.parameters.get(key) for key in ["permanent_water_layer_id", "slope_layer_id"] if source_job.parameters.get(key))
    if reference.id in used:
        raise FlagwaError("REFERENCE_DATA_LEAKAGE", "A context layer used by the analysis cannot serve as held-out validation", 422)
    dates = result.metadata_json.get("acquisition_dates", [])
    after = parse_datetime(dates[-1]) if dates else None
    if after is None or abs((evidence.observation_datetime - after).total_seconds()) > payload.maximum_reference_age_days * 86400:
        raise FlagwaError("REFERENCE_TEMPORAL_MISMATCH", "Reference date does not meet the explicit temporal tolerance", 422)
    if payload.approve and uses_synthetic_inputs(result, reference):
        raise FlagwaError("SYNTHETIC_VALIDATION_FORBIDDEN", "Synthetic fixtures can be assessed but never approved as genuine validated observations", 422)
    if payload.approve and not all(payload.checklist.model_dump().values()):
        raise FlagwaError("SCIENTIFIC_REVIEW_INCOMPLETE", "Approval requires all explicit scientific review checks", 422)
    return reference


def assess_validation(session, result, payload, job_id, progress):
    reference = validation_reference(session, result, payload)
    storage = get_storage()
    with rasterio.open(storage.get_file(result.output_path)) as source:
        if source.width * source.height > get_settings().max_processing_pixels:
            raise FlagwaError("PROCESSING_LIMIT", "Validation raster exceeds pixel allocation limit", 413)
        layer = RasterLayer(source.read(1), source.crs, source.transform)
    progress(30)
    path = storage.get_file(reference.file_path)
    observed = read_context_grid(path, layer)
    metrics = binary_metrics(layer.data, observed, payload.reference_positive_values)
    criteria_met = (metrics["valid_pixels"] >= payload.minimum_valid_pixels
                    and metrics["reference_positive_pixels"] >= payload.minimum_reference_positive_pixels
                    and metrics["coverage_fraction"] >= payload.minimum_coverage
                    and all(metrics[name] is not None and metrics[name] >= getattr(payload, f"minimum_{name}") for name in ["iou", "precision", "recall"]))
    with path.open("rb") as source:
        checksum = hashlib.file_digest(source, "sha256").hexdigest()
    record = {"id": new_id(), "validation_job_id": job_id, "assessed_at": utcnow().isoformat(),
              "reference_layer_id": reference.id, "reference_source": reference.source, "reference_version": reference.version,
              "reference_sha256": checksum, "reference_evidence": reference.metadata_json["validation_evidence"],
              "reference_provenance": reference.metadata_json,
              "metrics": metrics, "review": payload.model_dump(mode="json"), "criteria_met": criteria_met,
              "approved": bool(payload.approve and criteria_met),
              "limitations": "Reference error and representativeness remain part of uncertainty; pixel agreement alone is not proof of disaster impact"}
    progress(80)
    return record