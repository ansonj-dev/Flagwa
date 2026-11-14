import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin
from shapely.geometry import Point, box, mapping

from app.core.exceptions import FlagwaError
from app.services.context.exposure import raster_exposure, vector_exposure


def test_population_pixel_center_sum(tmp_path):
    path = tmp_path / "synthetic_population.tif"
    with rasterio.open(path, "w", driver="GTiff", width=2, height=2, count=1,
                       dtype="float32", crs=4326, transform=from_origin(76, 10, .01, .01), nodata=-9999) as output:
        output.write(np.array([[10, 20], [30, -9999]], dtype="float32"), 1)
    result = raster_exposure(path, mapping(box(76, 9.98, 76.02, 10)), "people/pixel")
    assert result["estimate"] == 60
    assert result["valid_coverage_fraction"] == pytest.approx(.75)
    partial = raster_exposure(path, mapping(box(76, 9.98, 76.04, 10)), "people/pixel")
    assert partial["extent_coverage_fraction"] == pytest.approx(.5)
    assert partial["valid_coverage_fraction"] == pytest.approx(.375)
    with pytest.raises(FlagwaError):
        raster_exposure(path, mapping(box(76, 9.98, 76.02, 10)), "people/km2")


def test_vector_intersection_and_meter_buffer():
    collection = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": mapping(Point(76.005, 9.995)), "properties": {"name": "synthetic inside"}},
        {"type": "Feature", "geometry": mapping(Point(76.0101, 9.995)), "properties": {"name": "synthetic nearby"}},
        {"type": "Feature", "geometry": mapping(Point(77, 10)), "properties": {"name": "synthetic outside"}},
    ]}
    query = mapping(box(76, 9.99, 76.01, 10))
    assert len(vector_exposure(collection, query)["features"]) == 1
    assert len(vector_exposure(collection, query, distance_m=100)["features"]) == 2