import pytest

from app.core.exceptions import FlagwaError
from app.core.security import trusted_download_url
from app.services.storage.local import LocalStorage


def test_storage_roundtrip_and_missing(tmp_path):
    storage = LocalStorage(tmp_path / "store")
    source = tmp_path / "synthetic.txt"
    source.write_text("synthetic fixture")
    storage.put_file(source, "processed/fixture.txt")
    assert storage.get_file("processed/fixture.txt").read_text() == "synthetic fixture"
    storage.delete("processed/fixture.txt")
    assert not storage.exists("processed/fixture.txt")
    with pytest.raises(FlagwaError):
        storage.get_file("missing")


@pytest.mark.parametrize("key", ["../secret", "/etc/passwd", "a/../../secret", "a\\secret", "s3://bucket/key", "."])
def test_storage_path_traversal(tmp_path, key):
    with pytest.raises(FlagwaError):
        LocalStorage(tmp_path).path(key)


def test_storage_symlink_escape(tmp_path):
    root = tmp_path / "store"
    root.mkdir()
    (root / "escape").symlink_to(tmp_path, target_is_directory=True)
    with pytest.raises(FlagwaError):
        LocalStorage(root).path("escape/private")


def test_staging_partial_in_same_storage_root_is_promoted_safely(tmp_path):
    storage = LocalStorage(tmp_path)
    partial = storage.path("raw/synthetic/product.h5.partial")
    partial.parent.mkdir(parents=True)
    partial.write_bytes(b"synthetic staged product")
    storage.put_file(partial, "raw/synthetic/product.h5")
    assert storage.get_file("raw/synthetic/product.h5").read_bytes() == partial.read_bytes()
    assert partial.exists()


@pytest.mark.parametrize("url", ["http://localhost/a", "https://127.0.0.1/a", "https://asf.alaska.edu.evil.invalid/a", "file:///etc/passwd", "https://user:pass@asf.alaska.edu/a", "https://arbitrary.cloudfront.net/product"])
def test_ssrf_rejected(url):
    with pytest.raises(FlagwaError):
        trusted_download_url(url)