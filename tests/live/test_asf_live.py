import os

import pytest

from app.schemas.catalog import CatalogSearch
from app.services.nisar.asf_client import ASFClient


@pytest.mark.live
@pytest.mark.skipif(os.getenv("LIVE_PROVIDER_TESTS", "false").lower() != "true", reason="Set LIVE_PROVIDER_TESTS=true for metadata-only network access")
def test_public_nisar_catalogue():
    query = CatalogSearch(bbox=(76.25, 9.2, 76.55, 9.5), start="2026-10-21T00:00:00Z",
                          end="2026-11-14T23:59:59Z", limit=2)
    scenes, more = ASFClient().search(query)
    assert isinstance(more, bool)
    assert all(scene.scene_id and scene.metadata["original"] for scene in scenes)