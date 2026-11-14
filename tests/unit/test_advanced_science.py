from datetime import datetime, timedelta, timezone

import numpy as np
import pytest
import h5py
from pyproj import Transformer
from shapely.geometry import box, mapping

from app.services.processing.agriculture import agricultural_response
from app.services.processing.deformation import referenced_los
from app.services.processing.forest_change import forest_candidates
from app.services.processing.glacier import glacier_offsets
from app.services.processing.wildfire import wildfire_candidates
from app.services.processing.hdf5_reader import read_geocoded
from app.services.processing.hdf5_reader import valid_samples
from app.services.processing.advanced_pipeline import compatible_measurement_groups
from app.core.exceptions import FlagwaError


def test_forest_requires_both_polarizations_forest_and_spatial_support():
    before = np.full((5, 5), .1, dtype="float32")
    after = before.copy()
    after[1:3, 1:3] = .01
    after[4, 4] = .01
    forest = np.ones(before.shape)
    classes, layers = forest_candidates(before, after, before, after, forest, -3, -3, kernel=1, minimum_pixels=2)
    assert (classes == 3).sum() == 4
    assert classes[4, 4] == 4
    assert np.isclose(layers["co_change_db"][1, 1], -10)
    classes, _ = forest_candidates(before, after, before, before, forest, -3, -3, kernel=1)
    assert not (classes == 3).any()
    classes, _ = forest_candidates(before, after, before, after, np.zeros(before.shape), -3, -3, kernel=1)
    assert not (classes == 3).any()


def test_wildfire_requires_actual_perimeter_and_optical_agreement():
    before = np.full((4, 4), .1, dtype="float32")
    after = np.full((4, 4), 1, dtype="float32")
    perimeter = np.zeros(before.shape)
    perimeter[:2] = 1
    optical = np.ones(before.shape)
    optical[0, 0] = 0
    classes, _ = wildfire_candidates(before, after, before, after, perimeter, optical, 3, kernel=1, minimum_pixels=1)
    assert (classes == 3).sum() == 7
    assert classes[0, 0] == 4
    assert (classes[2:] == 1).all()


def test_agriculture_is_dated_time_series_not_crop_yield_or_soil_moisture():
    dates = [datetime(2026, 6, 1, tzinfo=timezone.utc) + timedelta(days=12 * index) for index in range(4)]
    values = [np.full((2, 2), 10 ** ((-15 + index) / 10), dtype="float32") for index in range(4)]
    result = agricultural_response(values, dates, np.ones((2, 2)))
    np.testing.assert_allclose(result["trend_db_per_day"], 1 / 12, rtol=1e-5)
    np.testing.assert_allclose(result["temporal_range_db"], 3, atol=1e-5)
    with pytest.raises(ValueError):
        agricultural_response(values[:2], dates[:2], np.ones((2, 2)))
    values[0][0, 0] = np.nan
    values[1][0, 0] = 0
    assert np.isnan(agricultural_response(values, dates, np.ones((2, 2)))["trend_db_per_day"][0, 0])


def test_glacier_preserves_radar_coordinates_and_filters_quality():
    along = np.array([[3, 3]], dtype="float32")
    across = np.array([[4, 4]], dtype="float32")
    result = glacier_offsets(along, across, np.array([[.9, .1]]), np.ones((1, 2)), 10, .5, "m")
    assert result["radar_coordinate_rate_m_per_day"][0, 0] == pytest.approx(.5)
    assert np.isnan(result["radar_coordinate_rate_m_per_day"][0, 1])
    with pytest.raises(ValueError):
        glacier_offsets(along, across, np.ones((1, 2)), np.ones((1, 2)), 10, .5, "pixels")


def test_deformation_uses_phase_wavelength_reference_and_connected_components():
    phase = np.array([[1, 1 + 4 * np.pi / .24], [1, 1]], dtype="float64")
    components = np.array([[1, 1], [2, 1]])
    coherence = np.array([[.9, .9], [.9, .1]])
    output = referenced_los(phase, coherence, components, .24, (0, 0), .3, -1)
    assert output[0, 0] == 0
    assert output[0, 1] == pytest.approx(-1)
    assert np.isnan(output[1]).all()
    corrected = referenced_los(phase, np.ones((2, 2)), np.ones((2, 2)), .24, (0, 0), .3, -1, [phase - 1])
    np.testing.assert_allclose(corrected, 0)
    with pytest.raises(ValueError):
        referenced_los(phase, coherence, components, .24, (1, 1), .3, -1)


def test_geocoded_reader_preserves_zero_and_negative_phase(tmp_path):
    path = tmp_path / "SYNTHETIC_GUNW.h5"
    dataset_path = "/science/LSAR/GUNW/grids/frequencyA/unwrappedPhase"
    with h5py.File(path, "w") as product:
        group = product.create_group("/science/LSAR/GUNW/grids/frequencyA")
        group.create_dataset("unwrappedPhase", data=np.array([[0, -1], [2, -999]], dtype="float32")).attrs.update(units="radians", _FillValue=-999)
        group.create_dataset("xCoordinates", data=[500000, 500080])
        group.create_dataset("yCoordinates", data=[1000000, 999920])
        group.create_dataset("projection", data=32643)
    transformer = Transformer.from_crs(32643, 4326, always_xy=True)
    west, south = transformer.transform(499959, 999879)
    east, north = transformer.transform(500121, 1000041)
    layer = read_geocoded(path, mapping(box(west, south, east, north)), dataset_path, {"radians"})
    assert layer.data[0, 0] == 0
    assert layer.data[0, 1] == -1
    assert np.isnan(layer.data[1, 1])


def test_hdf5_explicit_fill_is_distinct_from_default_zero(tmp_path):
    with h5py.File(tmp_path / "SYNTHETIC_fill.h5", "w") as product:
        default = product.create_dataset("default", data=np.array([0, 1], dtype="float32"))
        explicit = product.create_dataset("explicit", data=np.array([0, -9999], dtype="float32"), fillvalue=-9999)
        assert valid_samples(default, default[()]).tolist() == [True, True]
        assert valid_samples(explicit, explicit[()]).tolist() == [True, False]


def test_product_measurements_cannot_mix_frequency_or_polarization():
    compatible_measurement_groups("/science/LSAR/GUNW/frequencyA/HH/phase", "/science/LSAR/GUNW/frequencyA/HH/coherence")
    with pytest.raises(FlagwaError):
        compatible_measurement_groups("/science/LSAR/GUNW/frequencyA/HH/phase", "/science/LSAR/GUNW/frequencyB/HH/coherence")
    with pytest.raises(FlagwaError):
        compatible_measurement_groups("/science/LSAR/GUNW/frequencyA/HH/phase", "/science/LSAR/GUNW/frequencyA/VV/coherence")