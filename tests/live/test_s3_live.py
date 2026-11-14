import os
from uuid import uuid4

import pytest
from botocore.exceptions import ConnectionClosedError, EndpointConnectionError
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.core.config import Settings
from app.services.storage.object_storage import ObjectStorage


@pytest.mark.live
@pytest.mark.skipif(os.getenv("RUN_S3_TESTS") != "true", reason="Set RUN_S3_TESTS=true and private S3_TEST_* settings for a real isolated bucket test")
def test_real_s3_compatible_roundtrip_and_cache(tmp_path):
    settings = Settings(_env_file=None, app_env="test", storage_backend="s3", s3_bucket="flagwa-integration-" + uuid4().hex,
                        s3_endpoint_url=os.environ["S3_TEST_ENDPOINT_URL"], s3_access_key_id=os.environ["S3_TEST_ACCESS_KEY_ID"],
                        s3_secret_access_key=os.environ["S3_TEST_SECRET_ACCESS_KEY"], s3_server_side_encryption="none",
                        local_storage_path=tmp_path / "staging", min_free_disk_bytes=0)
    storage = ObjectStorage(settings)

    @retry(retry=retry_if_exception_type((EndpointConnectionError, ConnectionClosedError)), wait=wait_exponential(max=4), stop=stop_after_attempt(5), reraise=True)
    def create_bucket():
        storage.client.create_bucket(Bucket=settings.s3_bucket)

    create_bucket()
    try:
        source = tmp_path / "synthetic-object.txt"
        source.write_text("SYNTHETIC S3 COMPATIBILITY FIXTURE; not satellite observations")
        storage.put_file(source, "processed/synthetic.txt")
        assert storage.exists("processed/synthetic.txt")
        assert storage.get_file("processed/synthetic.txt").read_bytes() == source.read_bytes()
        assert storage.get_file("processed/synthetic.txt").read_bytes() == source.read_bytes()
        storage.delete("processed/synthetic.txt")
        assert not storage.exists("processed/synthetic.txt")
    finally:
        objects = storage.client.list_objects_v2(Bucket=settings.s3_bucket).get("Contents", [])
        for item in objects:
            storage.client.delete_object(Bucket=settings.s3_bucket, Key=item["Key"])
        storage.client.delete_bucket(Bucket=settings.s3_bucket)