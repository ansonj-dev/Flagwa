import pytest

from app.core.exceptions import FlagwaError
from app.services.processing.capabilities import CAPABILITIES, require_implementation


@pytest.mark.parametrize("theme", ["forest", "agriculture", "wildfire", "glacier", "deformation"])
def test_unimplemented_science_is_never_claimed_operational(theme):
    assert CAPABILITIES[theme]["status"] == "not_implemented"
    with pytest.raises(FlagwaError) as caught:
        require_implementation(theme)
    assert caught.value.status == 501


def test_flood_implementation_exists_but_not_scientifically_validated():
    require_implementation("flood")
    assert "pending_scientific_validation" in CAPABILITIES["flood"]["status"]