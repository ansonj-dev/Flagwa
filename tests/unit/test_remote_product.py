import pytest

from app.core.exceptions import FlagwaError
from app.services.nisar.remote_product import ByteBudget


def test_remote_read_budget_is_strict():
    budget = ByteBudget(4096)
    budget.reserve(2048)
    budget.reserve(2048)
    assert budget.requested == 4096
    with pytest.raises(FlagwaError):
        budget.reserve(1)
    with pytest.raises(FlagwaError):
        budget.reserve(-1)