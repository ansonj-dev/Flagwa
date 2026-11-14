import numpy as np
import pytest
from types import SimpleNamespace

from app.services.validation import binary_metrics, uses_synthetic_inputs


def test_independent_binary_metrics_and_uncertainty_coverage():
    classification = np.array([[3, 3, 1, 4, 0]])
    reference = np.array([[1, 0, 1, 1, 1]])
    metrics = binary_metrics(classification, reference, [1])
    assert metrics["true_positive"] == 1
    assert metrics["false_positive"] == 1
    assert metrics["false_negative"] == 1
    assert metrics["iou"] == pytest.approx(1 / 3)
    assert metrics["precision"] == metrics["recall"] == .5
    assert metrics["coverage_fraction"] == .75


def test_no_event_is_not_perfect_validation():
    metrics = binary_metrics(np.ones((2, 2)), np.zeros((2, 2)), [1])
    assert metrics["iou"] is None
    assert metrics["recall"] is None
    assert metrics["reference_positive_pixels"] == 0


def test_validation_unknown_reference_is_excluded_not_negative():
    metrics = binary_metrics(np.array([[3, 1]]), np.array([[1, np.nan]]), [1])
    assert metrics["iou"] == 1
    assert metrics["valid_pixels"] == 1
    assert metrics["coverage_fraction"] == .5


def test_fixture_detection_uses_provenance_not_radar_instrument_name():
    result = SimpleNamespace(metadata_json={"source_scenes": []})
    reference = SimpleNamespace(source="Synthetic aperture radar reference", metadata_json={})
    assert not uses_synthetic_inputs(result, reference)
    reference.metadata_json["is_synthetic"] = True
    assert uses_synthetic_inputs(result, reference)
    reference.metadata_json.clear()
    result.metadata_json["synthetic"] = True
    assert uses_synthetic_inputs(result, reference)