import pytest

from app.services.processing.capabilities import CAPABILITIES, require_implementation


@pytest.mark.parametrize("theme", ["forest", "agriculture", "wildfire", "glacier", "deformation"])
def test_experimental_science_is_never_claimed_operational(theme):
    assert CAPABILITIES[theme]["status"] == "experimental_not_live_validated"
    assert CAPABILITIES[theme]["operational"] is False
    require_implementation(theme)


def test_flood_implementation_exists_but_not_scientifically_validated():
    require_implementation("flood")
    assert "pending_scientific_validation" in CAPABILITIES["flood"]["status"]