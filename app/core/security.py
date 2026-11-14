import hashlib
import hmac
import ipaddress
import socket
from urllib.parse import urlparse

from fastapi import Header, Request
from redis import Redis
from redis.exceptions import RedisError

from app.core.config import get_settings
from app.core.exceptions import FlagwaError


def require_admin(request: Request, x_admin_key: str | None = Header(default=None)):
    settings = get_settings()
    configured = settings.admin_api_key.get_secret_value()
    if configured:
        if not x_admin_key or not hmac.compare_digest(x_admin_key, configured):
            raise FlagwaError("ADMIN_UNAUTHORIZED", "Valid X-Admin-Key is required", 401)
    elif settings.app_env == "production" or not request.client or request.client.host not in {"127.0.0.1", "::1"}:
        raise FlagwaError("ADMIN_NOT_CONFIGURED", "Write access is restricted to loopback until ADMIN_API_KEY is configured", 403)


def expensive_request(request: Request):
    settings = get_settings()
    address = request.client.host if request.client else "unknown"
    key = "flagwa:rate:" + hashlib.sha256(address.encode()).hexdigest()
    try:
        client = Redis.from_url(settings.redis_url.get_secret_value(), socket_connect_timeout=2, socket_timeout=2)
        count = client.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n", 1, key)
    except RedisError:
        raise FlagwaError("RATE_LIMIT_UNAVAILABLE", "Expensive requests unavailable while Redis is offline", 503) from None
    finally:
        if "client" in locals():
            client.close()
    if count > settings.expensive_requests_per_minute:
        raise FlagwaError("RATE_LIMITED", "Too many expensive requests; retry after one minute", 429)


def trusted_download_url(url: str, provider="ASF"):
    parsed = urlparse(url)
    domains = ("asf.alaska.edu", "earthdatacloud.nasa.gov", "earthdata.nasa.gov") if provider == "ASF" else ("bhoonidhi-api.nrsc.gov.in",)
    hostname = parsed.hostname or ""
    configured_hosts = get_settings().asf_cdn_hosts if provider == "ASF" else get_settings().bhoonidhi_download_hosts
    approved_cdn = hostname in [host.strip() for host in configured_hosts.split(",") if host.strip()]
    if (parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443)
            or not (approved_cdn or any(hostname == domain or hostname.endswith("." + domain) for domain in domains))):
        raise FlagwaError("UNTRUSTED_PROVIDER_URL", "Provider returned a disallowed download destination", 502)
    try:
        addresses = socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(entry[4][0]).is_global for entry in addresses):
            raise ValueError()
    except (OSError, ValueError):
        raise FlagwaError("UNTRUSTED_PROVIDER_HOST", "Provider hostname did not resolve to a public address", 502) from None
    return url