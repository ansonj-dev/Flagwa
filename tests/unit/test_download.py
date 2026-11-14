import hashlib
from io import BytesIO
from types import SimpleNamespace

import h5py
import numpy as np
import pytest
from requests import ConnectionError

from app.core.config import Settings
from app.core.exceptions import FlagwaError
from app.services.nisar import scene_download
from app.services.storage.local import LocalStorage


@pytest.fixture
def transfer(tmp_path, monkeypatch):
    buffer = BytesIO()
    with h5py.File(buffer, "w") as product:
        product.create_dataset("SYNTHETIC_TEST_ONLY", data=np.ones((2, 2)))
    data = buffer.getvalue()
    storage = LocalStorage(tmp_path / "store")
    settings = Settings(_env_file=None, local_storage_path=tmp_path / "staging", min_free_disk_bytes=0, max_download_bytes=1_000_000)
    monkeypatch.setattr(scene_download, "get_settings", lambda: settings)
    monkeypatch.setattr(scene_download, "get_storage", lambda: storage)
    feature = {"properties": {"url": "https://example.invalid/synthetic.h5", "md5sum": hashlib.md5(data, usedforsecurity=False).hexdigest()}}
    monkeypatch.setattr(scene_download.ASFClient, "resolve", lambda *args: feature)

    class Response:
        status_code = 200
        headers = {"Content-Length": str(len(data))}
        closed = False

        def iter_content(self, chunk_size):
            yield data

        def close(self):
            self.closed = True

    response = Response()
    monkeypatch.setattr(scene_download, "asf_response", lambda *args: response)
    scene = SimpleNamespace(scene_id="SYNTHETIC_DOWNLOAD", provider="ASF", download_status="QUEUED", file_path=None, metadata_json={})
    return scene, response, storage, feature, settings


def test_authorized_download_checksum_and_duplicate(transfer):
    scene, response, storage, feature, settings = transfer
    key, details = scene_download.download_scene(scene, lambda progress: None)
    assert storage.exists(key)
    assert details["provider_md5_verified"]
    assert response.closed
    scene.download_status, scene.file_path = "COMPLETED", key
    assert scene_download.download_scene(scene, lambda progress: None)[0] == key


def test_checksum_failure_cleans_partial_file(transfer):
    scene, response, storage, feature, settings = transfer
    feature["properties"]["md5sum"] = "bad-checksum"
    with pytest.raises(FlagwaError) as caught:
        scene_download.download_scene(scene, lambda progress: None)
    assert caught.value.code == "CHECKSUM_MISMATCH"
    assert not storage.exists(scene_download.scene_key(scene.scene_id))
    assert not list(settings.local_storage_path.rglob("*.partial"))


def test_partial_stream_is_retryable_and_cleaned(transfer):
    scene, response, storage, feature, settings = transfer

    def interrupted(chunk_size):
        yield b"synthetic partial"
        raise ConnectionError("synthetic transport failure")

    response.iter_content = interrupted
    with pytest.raises(FlagwaError) as caught:
        scene_download.download_scene(scene, lambda progress: None)
    assert caught.value.code == "DOWNLOAD_INTERRUPTED"
    assert response.closed
    assert not list(settings.local_storage_path.rglob("*.partial"))


def test_transfer_limit_prevents_large_download(transfer):
    scene, response, storage, feature, settings = transfer
    settings.max_download_bytes = 1
    with pytest.raises(FlagwaError) as caught:
        scene_download.download_scene(scene, lambda progress: None)
    assert caught.value.code == "PRODUCT_TOO_LARGE"


def test_provider_size_mismatch_is_not_success(transfer):
    scene, response, storage, feature, settings = transfer
    response.headers = {"Content-Length": "1"}
    with pytest.raises(FlagwaError) as caught:
        scene_download.download_scene(scene, lambda progress: None)
    assert caught.value.code == "DOWNLOAD_INCOMPLETE"


def test_cdn_requests_do_not_forward_earthdata_authorization(monkeypatch):
    class Session:
        def get(self, url, **kwargs):
            assert kwargs["headers"]["Authorization"] is None
            assert kwargs["headers"]["Range"] == "bytes=0-4095"
            return SimpleNamespace(is_redirect=False, status_code=206)

    monkeypatch.setattr(scene_download, "trusted_download_url", lambda url: url)
    monkeypatch.setattr(scene_download, "earthdata_auth", lambda: SimpleNamespace(session=lambda: Session()))
    assert scene_download.asf_response("https://d1mv8zhcvry6x4.cloudfront.net/synthetic", "bytes=0-4095").status_code == 206