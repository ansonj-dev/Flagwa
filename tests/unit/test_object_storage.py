from pathlib import Path

import pytest
from botocore.exceptions import ClientError

from app.core.config import Settings
from app.core.exceptions import FlagwaError
from app.services.storage.object_storage import ObjectStorage


@pytest.fixture
def object_store(tmp_path, monkeypatch):
    objects = {}

    class Client:
        def upload_file(self, source, bucket, key, ExtraArgs):
            objects[key] = Path(source).read_bytes()

        def download_file(self, bucket, key, target):
            Path(target).write_bytes(objects[key])

        def head_object(self, Bucket, Key):
            if Key not in objects:
                raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
            return {"ContentLength": len(objects[Key])}

        def delete_object(self, Bucket, Key):
            objects.pop(Key, None)

    monkeypatch.setattr("app.services.storage.object_storage.boto3.client", lambda *args, **kwargs: Client())
    settings = Settings(_env_file=None, storage_backend="s3", s3_bucket="synthetic-test-only", local_storage_path=tmp_path / "cache", min_free_disk_bytes=0)
    return ObjectStorage(settings), tmp_path


def test_object_storage_roundtrip_cache_and_delete(object_store):
    storage, directory = object_store
    source = directory / "synthetic.txt"
    source.write_text("SYNTHETIC OBJECT STORAGE FIXTURE")
    storage.put_file(source, "processed/synthetic.txt")
    assert storage.exists("processed/synthetic.txt")
    assert storage.get_file("processed/synthetic.txt").read_text() == source.read_text()
    assert storage.get_file("processed/synthetic.txt").read_text() == source.read_text()
    storage.delete("processed/synthetic.txt")
    assert not storage.exists("processed/synthetic.txt")


def test_object_storage_missing_is_not_empty_success(object_store):
    storage, directory = object_store
    with pytest.raises(FlagwaError) as caught:
        storage.get_file("missing")
    assert caught.value.status == 404


def test_object_storage_checks_staging_capacity(object_store):
    storage, directory = object_store
    source = directory / "synthetic.txt"
    source.write_text("synthetic")
    storage.put_file(source, "large")
    storage.minimum_free = 10**30
    with pytest.raises(FlagwaError) as caught:
        storage.get_file("large")
    assert caught.value.code == "INSUFFICIENT_STORAGE"