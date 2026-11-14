import h5py
import numpy as np
from pyproj import CRS
from rasterio.transform import from_origin

from app.services.nisar.subset_download import write_subset
from app.services.processing.hdf5_reader import RasterLayer, inspect_product


def test_subset_preserves_measurements_quality_codes_and_identity(tmp_path):
    power = np.array([[.1, .2], [.3, np.nan]], dtype="float32")
    codes = np.array([[1, 2], [3, 255]], dtype="uint8")
    layer = RasterLayer(power, CRS.from_epsg(32643), from_origin(500000, 1000000, 10, 10), codes < 255,
                        {"identification": {"granuleId": "SYNTHETIC_SUBSET", "productType": "GCOV", "lookDirection": "Left"}}, codes)
    path = tmp_path / "synthetic-subset.h5"
    write_subset(path, layer, "SYNTHETIC_SUBSET", "A", "HHHH")
    with h5py.File(path, "r") as product:
        np.testing.assert_allclose(product["science/LSAR/GCOV/grids/frequencyA/HHHH"][()], power)
        np.testing.assert_array_equal(product["science/LSAR/GCOV/grids/frequencyA/mask"][()], codes)
        assert "not a complete NISAR product" in product.attrs["flagwa_derivative"]
    assert inspect_product(path)["identification"]["granuleId"] == "SYNTHETIC_SUBSET"