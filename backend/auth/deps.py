"""FastAPI dependencies and the fail-closed gate.

is_public() is the single source of truth for what an anonymous visitor may
reach, and it is written as an ALLOW-list on purpose: anything added to the
API later is protected by default. An endpoint can only become public by
someone editing this file, which is the decision we want to be deliberate.
"""

import hmac

from fastapi import Depends, HTTPException, Request

from backend.auth import sessions, store
from backend.config.settings import settings

# The only API paths an anonymous visitor may call. Everything else under
# /api/ requires a session.
_PUBLIC_API = {
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/me",            # returns {"user": null} rather than 401
    "/api/auth/register",
    "/api/auth/invite/check",
    "/api/auth/forgot",
    "/api/auth/reset/check",
    "/api/auth/reset",
}


def is_public(path: str) -> bool:
    """True for anything a logged-out browser is allowed to fetch."""
    if not path.startswith("/api/"):
        # the SPA shell, its hashed assets and the favicon must load so the
        # login page can be shown at all
        return True
    return path.rstrip("/") in _PUBLIC_API


def has_health_token(request: Request) -> bool:
    """The read-only escape hatch for scripts/healthcheck.py, which runs on the
    box with no browser and therefore no cookie.

    It is NOT a login: it grants no user, so anything using require_user (all
    of /api/auth's admin surface) still refuses. It only gets past the blanket
    middleware so the smoke tests can read the API. An empty setting means the
    bypass does not exist at all."""
    expected = settings.auth_health_token
    if not expected:
        return False
    return hmac.compare_digest(request.headers.get("x-health-token", ""), expected)


def current_user(request: Request) -> dict | None:
    """The signed-in user, or None. Never raises — for endpoints that behave
    differently when logged out rather than refusing."""
    if not settings.auth_enabled:
        # escape hatch for local development only; the VM runs with auth on
        return {"id": 0, "username": "dev", "display_name": "Dev",
                "is_admin": 1, "is_active": 1}
    return store.session_user(request.cookies.get(sessions.COOKIE, ""))


def require_user(request: Request) -> dict:
    user = current_user(request)
    if not user:
        raise HTTPException(401, "sign in to continue")
    return user


def require_admin(user: dict = Depends(require_user)) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(403, "admin only")
    return user


def client_ip(request: Request) -> str:
    """Best-effort caller IP for login throttling. X-Forwarded-For is only
    trusted for its FIRST hop and only because this app sits behind our own
    reverse proxy; it is used for rate-limit bucketing, never for authz."""
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "?"
