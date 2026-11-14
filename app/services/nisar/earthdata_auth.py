import netrc
from functools import lru_cache
from threading import local

import asf_search as asf
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from app.core.config import get_settings
from app.core.exceptions import FlagwaError


class BoundedASFSession(asf.ASFSession):
    def __init__(self, timeout=60):
        super().__init__()
        self.default_timeout = timeout
        self.mount("https://", HTTPAdapter(max_retries=Retry(
            total=2, backoff_factor=0.5, status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods={"GET", "POST"},
        )))

    def request(self, method, url, **kwargs):
        kwargs.setdefault("timeout", self.default_timeout)
        return super().request(method, url, **kwargs)


def netrc_credentials():
    try:
        entry = netrc.netrc().authenticators("urs.earthdata.nasa.gov")
        return (entry[0], entry[2]) if entry else None
    except (OSError, netrc.NetrcParseError):
        return None


class EarthdataAuth:
    def __init__(self, settings=None):
        self.settings = settings or get_settings()
        self.state = local()

    def status(self):
        configured = bool(self.settings.earthdata_token.get_secret_value()
                          or self.settings.earthdata_username.get_secret_value() or netrc_credentials())
        return {"configured": configured, "authentication_verified": bool(getattr(self.state, "session", None)),
                "requires": "NASA Earthdata Login and ASF application authorization"}

    def session(self):
        if getattr(self.state, "session", None) is not None:
            return self.state.session
        session = BoundedASFSession(self.settings.provider_timeout_seconds)
        try:
            if self.settings.earthdata_token.get_secret_value():
                session.auth_with_token(self.settings.earthdata_token.get_secret_value())
            elif self.settings.earthdata_username.get_secret_value():
                session.auth_with_creds(self.settings.earthdata_username.get_secret_value(),
                                        self.settings.earthdata_password.get_secret_value())
            elif credentials := netrc_credentials():
                session.auth_with_creds(*credentials)
            else:
                raise FlagwaError("EARTHDATA_NOT_CONFIGURED", "Configure Earthdata credentials or a private .netrc", 503)
        except FlagwaError:
            session.close()
            raise
        except Exception:
            session.close()
            raise FlagwaError("EARTHDATA_AUTH_FAILED", "Earthdata authentication failed; check access and credentials", 502) from None
        self.state.session = session
        return session


@lru_cache
def earthdata_auth():
    return EarthdataAuth()