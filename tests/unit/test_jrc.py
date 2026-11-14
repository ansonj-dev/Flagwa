import numpy as np
import pytest

from app.core.exceptions import FlagwaError
from app.services.context.jrc import seasonality_to_permanent, tile_name


def test_kuttanad_official_tile_name_and_multitile_rejection():
    assert tile_name((76.25, 9.2, 76.55, 9.5)) == "seasonality_70E_10Nv1_4_2021.tif"
    with pytest.raises(FlagwaError):
        tile_name((76, 9, 81, 10))


def test_seasonality_derivation_and_nodata():
    values = np.array([[0, 6, 12, 255, 12]], dtype="uint8")
    valid = np.array([[True, True, True, True, False]])
    assert seasonality_to_permanent(values, valid).tolist() == [[0, 0, 1, 255, 255]]