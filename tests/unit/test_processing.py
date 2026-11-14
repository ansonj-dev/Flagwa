import json

import h5py
import numpy as np
import pytest
import rasterio
from pydantic import ValidationError
from pyproj import CRS, Transformer
from rasterio.transform import from_origin
from shapely.geometry import box, mapping

from app.core.exceptions import FlagwaError
from app.schemas.analysis import FloodParameters
from app.services.processing.backscatter import calculate_backscatter_change, power_to_db
from app.services.processing.exports import write_cog, write_preview, write_vectors
from app.services.processing.flood_detection import classify_flood
from app.services.processing.hdf5_reader import RasterLayer, inspect_product, read_gcov
from app.services.processing.raster_alignment import align_to


@pytest.fixture
def flood_parameters():
    return FloodParameters(threshold_basis="Synthetic test thresholds, not scientifically calibrated", quality_valid_values=[1],
                           quality_rule_source="Synthetic fixture mask: 1 is valid")


def test_power_to_db_invalid_values():
    result = power_to_db([1, 10, 0, -1, np.nan, np.inf])
    np.testing.assert_allclose(result[:2], [0, 10])
    assert np.isnan(result[2:]).all()
    np.testing.assert_allclose(calculate_backscatter_change([1, 10], [10, 1]), [10, -10])
    with pytest.raises(ValueError):
        calculate_backscatter_change([1], [1, 2])


@pytest.mark.parametrize("changes", [{"quality_valid_values": [0]}, {"quality_valid_values": [255]}, {"before_db_min": -20}])
def test_flood_rules_reject_invalid_quality_and_overlapping_states(flood_parameters, changes):
    with pytest.raises(ValidationError):
        FloodParameters.model_validate(flood_parameters.model_dump() | changes)


def test_flood_permanent_uncertain_invalid(flood_parameters):
    before = np.array([[0.1, 0.1, 0.1, 0, 0.1, 0.1]], dtype="float32")
    after = np.array([[0.005, 0.005, 0.1, 0.005, 0.005, 0.005]], dtype="float32")
    water = np.array([[0, 1, 0, 0, np.nan, 0]], dtype="float32")
    quality = np.array([[True, True, True, True, True, False]])
    classes, change = classify_flood(before, after, water, flood_parameters, quality, quality)
    assert classes.tolist() == [[3, 2, 1, 0, 4, 0]]
    assert np.isnan(change[0, 3])
    classes, _ = classify_flood(before, after, water, flood_parameters)
    assert classes[0, 0] == 4
    classes, _ = classify_flood(before, after, water, flood_parameters, quality, quality, np.full(before.shape, 20))
    assert classes[0, 0] == 4


def test_hdf5_discovery_subset_and_fill(tmp_path):
    path = tmp_path / "SYNTHETIC_GCOV.h5"
    with h5py.File(path, "w") as product:
        group = product.create_group("nonstandardRoot/LSAR/GCOV/grids/frequencyA")
        data = np.full((8, 8), 0.1, dtype="float32")
        data[0, 0] = -9999
        group.create_dataset("HHHH", data=data).attrs["_FillValue"] = -9999
        group.create_dataset("xCoordinates", data=500000 + np.arange(8) * 20)
        group.create_dataset("yCoordinates", data=1000000 - np.arange(8) * 20)
        group.create_dataset("projection", data=32643)
        group.create_dataset("mask", data=np.ones((8, 8), dtype="uint8"))
    transformer = Transformer.from_crs(32643, 4326, always_xy=True)
    west, south = transformer.transform(499990, 999850)
    east, north = transformer.transform(500150, 1000010)
    aoi = mapping(box(west, south, east, north))
    inspection = inspect_product(path)
    assert len(inspection["frequency_groups"]) == 1
    layer = read_gcov(path, aoi, quality_valid_values=[1])
    assert layer.crs.to_epsg() == 32643
    assert np.isnan(layer.data[0, 0])
    with pytest.raises(FlagwaError):
        read_gcov(path, aoi, quality_valid_values=None)
    with pytest.raises(FlagwaError):
        read_gcov(path, aoi, term="VVVV", quality_valid_values=[1])


def test_alignment_resolution_and_offset():
    reference = RasterLayer(np.ones((4, 4), dtype="float32"), CRS.from_epsg(32643), from_origin(500000, 1000000, 20, 20))
    other = RasterLayer(np.full((8, 8), 2, dtype="float32"), reference.crs, from_origin(500000, 1000000, 10, 10), np.ones((8, 8), bool))
    aligned = align_to(reference, other)
    assert aligned.transform == reference.transform
    np.testing.assert_allclose(aligned.data, 2)
    other.transform = from_origin(500020, 1000000, 10, 10)
    assert np.isnan(align_to(reference, other).data[:, 0]).all()


def test_alignment_different_crs():
    reference = RasterLayer(np.ones((4, 4), dtype="float32"), CRS.from_epsg(4326), from_origin(76, 10, .01, .01))
    transformer = Transformer.from_crs(4326, 3857, always_xy=True)
    west, north = transformer.transform(76, 10)
    other = RasterLayer(np.ones((8, 8), dtype="float32"), CRS.from_epsg(3857), from_origin(west, north, 600, 600))
    aligned = align_to(reference, other)
    assert aligned.crs == reference.crs
    assert np.isfinite(aligned.data).any()


def test_actual_cog_geojson_and_preview_exports(tmp_path):
    classification = np.array([[0, 1], [2, 3]], dtype="uint8")
    layer = RasterLayer(classification, CRS.from_epsg(32643), from_origin(500000, 1000000, 20, 20))
    raster = tmp_path / "synthetic.tif"
    write_cog(raster, classification, layer, 0, categorical=True)
    with rasterio.open(raster) as source:
        np.testing.assert_array_equal(source.read(1), classification)
        assert source.tags(ns="IMAGE_STRUCTURE")["LAYOUT"] == "COG"
    vector = tmp_path / "synthetic.geojson"
    collection = write_vectors(vector, classification, layer, "synthetic-test")
    assert len(collection["features"]) == 1
    assert json.loads(vector.read_text())["type"] == "FeatureCollection"
    write_preview(tmp_path / "synthetic.png", classification)
    assert (tmp_path / "synthetic.png").stat().st_size > 0