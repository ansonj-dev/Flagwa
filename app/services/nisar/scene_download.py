import hashlib
import shutil
from urllib.parse import urljoin, urlparse

import h5py
import httpx
from requests import RequestException

from app.core.config import get_settings
from app.core.exceptions import FlagwaError
from app.core.security import trusted_download_url
from app.services.nisar.asf_client import ASFClient
from app.services.nisar.bhoonidhi_client import bhoonidhi_client
from app.services.nisar.earthdata_auth import earthdata_auth
from app.services.storage import get_storage
from app.services.storage.local import LocalStorage


def scene_key(scene_id):
    return "raw/nisar/" + hashlib.sha256(scene_id.encode()).hexdigest() + "/product.h5"


def asf_response(url, range_header=None):
    session = earthdata_auth().session()
    for redirect in range(7):
        trusted_download_url(url)
        headers = {"Range": range_header} if range_header else {}
        if urlparse(url).hostname in [host.strip() for host in get_settings().asf_cdn_hosts.split(",")]:
            headers["Authorization"] = None
        try:
            response = session.get(url, stream=True, allow_redirects=False,
                                   headers=headers)
        except RequestException:
            raise FlagwaError("DOWNLOAD_INTERRUPTED", "Provider transfer interrupted; the job may retry", 502) from None
        if response.is_redirect:
            url = urljoin(url, response.headers.get("Location", ""))
            response.close()
            continue
        return response
    raise FlagwaError("PROVIDER_REDIRECT_LIMIT", "Provider exceeded the allowed redirect limit", 502)


def download_scene(scene, progress):
    settings, storage = get_settings(), get_storage()
    key = scene_key(scene.scene_id)
    if scene.download_status == "COMPLETED" and scene.file_path and storage.exists(scene.file_path):
        return scene.file_path, scene.metadata_json.get("download", {})
    scratch = LocalStorage(settings.local_storage_path)
    target = scratch.path(key + ".partial")
    target.parent.mkdir(parents=True, exist_ok=True)
    available = shutil.disk_usage(target.parent).free - settings.min_free_disk_bytes
    if available <= 0:
        raise FlagwaError("INSUFFICIENT_STORAGE", "Insufficient staging disk space", 507)
    limit = min(available, settings.max_download_bytes)
    if scene.provider == "ASF":
        original = ASFClient().resolve(scene.scene_id)
        props = original["properties"]
        url = props.get("url")
        if not url:
            raise FlagwaError("DOWNLOAD_UNAVAILABLE", "Provider supplied no product URL", 409)
        expected_md5 = props.get("md5sum")
        expected_size = None
        file_info = props.get("bytes", {}).get(props.get("fileName"), {})
        if file_info.get("bytes") is not None:
            expected_size = int(file_info["bytes"])
        if expected_size and expected_size > limit:
            raise FlagwaError("PRODUCT_TOO_LARGE", "Product exceeds configured download or available disk limit", 413)
        response = asf_response(url)
        if response.status_code != 200:
            response.close()
            raise FlagwaError("DOWNLOAD_NOT_AUTHORIZED", "Provider did not return an authorized product", 502)
        chunks = response.iter_content(chunk_size=1024 * 1024)
        declared_size = response.headers.get("Content-Length")
    else:
        adapter = bhoonidhi_client()
        feature = scene.metadata_json["original"]
        if feature.get("properties", {}).get("Online") != "Y":
            raise FlagwaError("PRODUCT_OFFLINE", "Bhoonidhi product is not online", 409)
        request = adapter.client.build_request("GET", "/download", params={"id": scene.scene_id, "collection": feature["collection"]},
                                               headers={"Authorization": f"Bearer {adapter.token()}"})
        response = adapter.client.send(request, stream=True, follow_redirects=False)
        if response.status_code != 200:
            response.close()
            raise FlagwaError("BHOONIDHI_DOWNLOAD_FAILED", "Bhoonidhi download unavailable or unauthorized; redirects require review", 502)
        chunks = response.iter_bytes(chunk_size=1024 * 1024)
        declared_size = response.headers.get("Content-Length")
        expected_md5, expected_size = None, None
    digest, md5, size = hashlib.sha256(), hashlib.md5(usedforsecurity=False), 0
    try:
        if declared_size and int(declared_size) > limit:
            raise FlagwaError("PRODUCT_TOO_LARGE", "Product exceeds transfer limit", 413)
        with target.open("wb") as output:
            for chunk in chunks:
                if not chunk:
                    continue
                size += len(chunk)
                if size > limit:
                    raise FlagwaError("PRODUCT_TOO_LARGE", "Download exceeds storage limit", 413)
                output.write(chunk)
                digest.update(chunk)
                md5.update(chunk)
                progress(min(85, 5 + int(80 * size / int(declared_size))) if declared_size else 20)
        if size == 0 or (declared_size and size != int(declared_size)) or (expected_size and size != expected_size):
            raise FlagwaError("DOWNLOAD_INCOMPLETE", "Downloaded size does not match provider metadata", 502)
        if expected_md5 and md5.hexdigest().lower() != expected_md5.lower():
            raise FlagwaError("CHECKSUM_MISMATCH", "Provider checksum did not match downloaded product", 502)
        if not h5py.is_hdf5(target):
            raise FlagwaError("INVALID_PRODUCT", "Download is not an HDF5 product", 422)
        storage.put_file(target, key)
    except (RequestException, httpx.TransportError):
        raise FlagwaError("DOWNLOAD_INTERRUPTED", "Product stream was interrupted; a bounded retry is available", 502) from None
    finally:
        response.close()
        target.unlink(missing_ok=True)
    return key, {"bytes": size, "sha256": digest.hexdigest(), "provider_md5_verified": bool(expected_md5)}