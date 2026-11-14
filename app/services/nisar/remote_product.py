from contextlib import contextmanager

import aiohttp
from fsspec.asyn import sync
from fsspec.implementations.http import HTTPFile, HTTPFileSystem

from app.core.config import get_settings
from app.core.exceptions import FlagwaError
from app.core.security import trusted_download_url
from app.services.nisar.asf_client import ASFClient
from app.services.nisar.scene_download import asf_response


class ByteBudget:
    def __init__(self, maximum):
        self.maximum = maximum
        self.requested = 0

    def reserve(self, size):
        if size < 0 or self.requested + size > self.maximum:
            raise FlagwaError("REMOTE_READ_LIMIT", "Remote HDF5 inspection exceeded its explicit byte budget", 413)
        self.requested += size


class BoundedHTTPFile(HTTPFile):
    def __init__(self, *args, budget, **kwargs):
        self.budget = budget
        super().__init__(*args, **kwargs)

    def _fetch_range(self, start, end):
        self.budget.reserve(end - start)
        return super()._fetch_range(start, end)

    def _fetch_all(self):
        raise FlagwaError("REMOTE_FULL_READ_DISABLED", "Full remote reads are disabled; use explicit product download jobs", 413)


@contextmanager
def open_remote_product(scene_id, maximum_bytes=32 * 1024 * 1024):
    feature = ASFClient().resolve(scene_id)
    response = asf_response(feature["properties"]["url"], "bytes=0-4095")
    try:
        if response.status_code != 206:
            raise FlagwaError("RANGE_ACCESS_UNAVAILABLE", "Provider did not honor selective range access", 502)
        size = int(response.headers["Content-Range"].split("/")[-1])
        url = response.url
        trusted_download_url(url)
    finally:
        response.close()
    budget = ByteBudget(maximum_bytes)
    fs = HTTPFileSystem(client_kwargs={"timeout": aiohttp.ClientTimeout(total=get_settings().provider_timeout_seconds)},
                        skip_instance_cache=True)
    session = sync(fs.loop, fs.set_session)
    try:
        with BoundedHTTPFile(fs, url, session=session, size=size, mode="rb", block_size=131072, loop=fs.loop,
                             cache_type="blockcache", cache_options={"maxblocks": 64}, budget=budget,
                             allow_redirects=False) as product:
            yield product, budget
    finally:
        sync(fs.loop, session.close)