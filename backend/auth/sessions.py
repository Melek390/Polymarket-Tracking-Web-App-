"""Cookie handling and login throttling — the layer between HTTP and store.py.

The session cookie is HttpOnly (JavaScript can never read it, so an XSS bug
cannot exfiltrate a login) and SameSite=Lax, which stops another site POSTing
to our API with the user's cookie attached. Lax is the reason this app does
not need separate CSRF tokens: cross-site POSTs simply arrive without the
cookie and read as logged out.
"""

import time

from backend.auth import store
from backend.config.settings import settings

COOKIE = "pmt_session"


def set_cookie(response, token: str):
    response.set_cookie(
        COOKIE, token,
        max_age=settings.auth_session_days * 24 * 3600,
        httponly=True,
        samesite="lax",
        # Secure must be OFF for http://localhost testing and ON in
        # production; it is a setting, not a guess (AUTH_COOKIE_SECURE=true
        # lives in the VM's .env).
        secure=settings.auth_cookie_secure,
        path="/",
    )


def clear_cookie(response):
    response.delete_cookie(COOKIE, path="/")


def login(response, user: dict, user_agent: str = "") -> str:
    token = store.create_session(user["id"], settings.auth_session_days, user_agent)
    store.touch_login(user["id"])
    set_cookie(response, token)
    return token


def logout(response, token: str):
    if token:
        store.revoke_session(token)
    clear_cookie(response)


# ---- login throttling ----------------------------------------------------
# In-process, per (username, client ip). This app runs ONE uvicorn worker (the
# house rule), so a module-level dict genuinely is the whole picture — there
# is no second process holding a different count. It resets on restart, which
# is an acceptable trade for a three-user tool; the point is to make online
# guessing slow, not to be a WAF.

_FAILS: dict[tuple[str, str], list[float]] = {}
MAX_FAILS = 8
WINDOW_S = 15 * 60


def _key(username: str, ip: str) -> tuple[str, str]:
    return ((username or "").lower(), ip or "?")


def too_many_failures(username: str, ip: str) -> bool:
    hits = _FAILS.get(_key(username, ip), [])
    cutoff = time.monotonic() - WINDOW_S
    live = [t for t in hits if t > cutoff]
    return len(live) >= MAX_FAILS


def record_failure(username: str, ip: str):
    k = _key(username, ip)
    cutoff = time.monotonic() - WINDOW_S
    _FAILS[k] = [t for t in _FAILS.get(k, []) if t > cutoff] + [time.monotonic()]


def clear_failures(username: str, ip: str):
    _FAILS.pop(_key(username, ip), None)
