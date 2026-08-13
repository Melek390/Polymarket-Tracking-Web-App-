"""/api/auth — sign in, invite-only registration, password reset, admin.

Registration is CLOSED: the only way to get an account is to redeem an invite
an admin generated. There is deliberately no "sign up" path that does not
consume a token.

No mail server exists on this box, so reset links are handed over by an admin
rather than emailed. /forgot queues a request the admin sees in the panel;
the admin generates the link and passes it to the user. Everything is already
tokenised, so wiring SMTP later means sending `link` from one place instead of
returning it — no schema or flow change.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from backend.auth import deps, sessions, store
from backend.config.settings import settings

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])

MIN_PASSWORD = 8


class LoginBody(BaseModel):
    username: str
    password: str


class RegisterBody(BaseModel):
    invite: str
    username: str = Field(min_length=3, max_length=32)
    display_name: str = ""
    password: str


class TokenBody(BaseModel):
    token: str


class ForgotBody(BaseModel):
    username: str


class ResetBody(BaseModel):
    token: str
    password: str


class InviteBody(BaseModel):
    grants_admin: bool = False
    note: str = ""
    days: int | None = None


class UserActionBody(BaseModel):
    user_id: int


def _public(user: dict) -> dict:
    return {"id": user["id"], "username": user["username"],
            "display_name": user["display_name"],
            "is_admin": bool(user["is_admin"])}


def _check_password(pw: str):
    if len(pw or "") < MIN_PASSWORD:
        raise HTTPException(400, f"password must be at least {MIN_PASSWORD} characters")


# ---- session -------------------------------------------------------------

@router.get("/me")
def me(request: Request):
    """Who am I? Returns {"user": null} when logged out rather than 401, so
    the SPA can boot and decide to show the login page without an error."""
    user = deps.current_user(request)
    return {"user": _public(user) if user else None,
            "auth_enabled": settings.auth_enabled}


@router.post("/login")
def login(body: LoginBody, request: Request, response: Response):
    ip = deps.client_ip(request)
    if sessions.too_many_failures(body.username, ip):
        raise HTTPException(429, "too many attempts — wait a few minutes and try again")
    user = store.get_user_by_name(body.username)
    # One message for every failure mode: a different error for "no such user"
    # would let anyone enumerate who has an account.
    from backend.auth.security import verify_password
    if not user or not user["is_active"] or not verify_password(body.password, user["password_hash"]):
        sessions.record_failure(body.username, ip)
        raise HTTPException(401, "incorrect username or password")
    sessions.clear_failures(body.username, ip)
    sessions.login(response, user, request.headers.get("user-agent", ""))
    return {"user": _public(user)}


@router.post("/logout")
def logout(request: Request, response: Response):
    sessions.logout(response, request.cookies.get(sessions.COOKIE, ""))
    return {"ok": True}


# ---- invite-only registration -------------------------------------------

@router.post("/invite/check")
def invite_check(body: TokenBody):
    """Called by the register page before showing the form."""
    inv = store.peek_invite(body.token)
    if not inv:
        raise HTTPException(400, "this invitation link is invalid, already used, or expired")
    return {"ok": True, "grants_admin": bool(inv["grants_admin"])}


@router.post("/register")
def register(body: RegisterBody, request: Request, response: Response):
    inv = store.peek_invite(body.invite)
    if not inv:
        raise HTTPException(400, "this invitation link is invalid, already used, or expired")
    _check_password(body.password)
    from backend.auth.security import normalize_username
    uname = normalize_username(body.username)
    if not uname.isascii() or not uname.replace("_", "").replace("-", "").replace(".", "").isalnum():
        raise HTTPException(400, "username may use letters, numbers, dot, dash and underscore only")
    if store.get_user_by_name(uname):
        raise HTTPException(409, "that username is taken")

    user_id = store.create_user(uname, body.display_name or uname, body.password,
                                is_admin=bool(inv["grants_admin"]))
    # Consume LAST and check the result: if two people opened the same link at
    # once, only one UPDATE can win and the loser's account is rolled back.
    if not store.consume_invite(body.invite, user_id):
        store.set_active(user_id, False)
        raise HTTPException(409, "that invitation was just used by someone else")
    user = store.get_user(user_id)
    sessions.login(response, user, request.headers.get("user-agent", ""))
    log.info("auth: registered %s (admin=%s)", uname, bool(inv["grants_admin"]))
    return {"user": _public(user)}


# ---- password reset ------------------------------------------------------

@router.post("/forgot")
def forgot(body: ForgotBody):
    """Queue a reset request for the admin. Always reports success — telling
    the caller whether the account exists would leak the user list."""
    user = store.get_user_by_name(body.username)
    if user and user["is_active"]:
        store.request_reset(user["id"])
    return {"ok": True}


@router.post("/reset/check")
def reset_check(body: TokenBody):
    r = store.peek_reset(body.token)
    if not r:
        raise HTTPException(400, "this reset link is invalid, already used, or expired")
    return {"ok": True, "username": r["username"]}


@router.post("/reset")
def reset(body: ResetBody):
    _check_password(body.password)
    user_id = store.consume_reset(body.token)
    if not user_id:
        raise HTTPException(400, "this reset link is invalid, already used, or expired")
    store.set_password(user_id, body.password)
    # Changing a password logs every other browser out — the whole point of a
    # reset is that somebody else may have had access.
    store.revoke_all_sessions(user_id)
    store.clear_reset_requests(user_id)
    log.info("auth: password reset completed for user %s", user_id)
    return {"ok": True}


class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str


@router.post("/password")
def change_password(body: ChangePasswordBody, request: Request, response: Response,
                    user: dict = Depends(deps.require_user)):
    from backend.auth.security import verify_password
    full = store.get_user(user["id"])
    if not verify_password(body.current_password, full["password_hash"]):
        raise HTTPException(401, "current password is incorrect")
    _check_password(body.new_password)
    store.set_password(user["id"], body.new_password)
    store.revoke_all_sessions(user["id"])
    # keep THIS browser signed in
    sessions.login(response, full, request.headers.get("user-agent", ""))
    return {"ok": True}


# ---- admin ---------------------------------------------------------------

@router.get("/users")
def users(_: dict = Depends(deps.require_admin)):
    return {"users": store.list_users(),
            "invites": store.list_invites(),
            "reset_requests": store.list_reset_requests()}


@router.post("/invite")
def create_invite(body: InviteBody, request: Request,
                  admin: dict = Depends(deps.require_admin)):
    days = body.days or settings.auth_invite_days
    token = store.create_invite(admin["id"], days, body.grants_admin, body.note)
    return {"token": token, "link": _abs_link(request, "/register", token),
            "expires_days": days}


@router.post("/invite/revoke")
def revoke_invite(body: dict, _: dict = Depends(deps.require_admin)):
    store.revoke_invite(int(body.get("invite_id") or 0))
    return {"ok": True}


@router.post("/users/reset-link")
def admin_reset_link(body: UserActionBody, request: Request,
                     _: dict = Depends(deps.require_admin)):
    """Generate a reset link for a user and hand it back to the admin, who
    passes it on. This is the no-mail-server path."""
    user = store.get_user(body.user_id)
    if not user:
        raise HTTPException(404, "no such user")
    token = store.create_reset(user["id"], settings.auth_reset_hours)
    store.clear_reset_requests(user["id"])
    return {"link": _abs_link(request, "/reset", token),
            "username": user["username"], "expires_hours": settings.auth_reset_hours}


@router.post("/users/admin")
def set_admin(body: dict, admin: dict = Depends(deps.require_admin)):
    user_id, make = int(body.get("user_id") or 0), bool(body.get("is_admin"))
    user = store.get_user(user_id)
    if not user:
        raise HTTPException(404, "no such user")
    # never let the last admin demote themselves out of the system
    if not make and user["is_admin"] and store.admin_count() <= 1:
        raise HTTPException(400, "this is the only admin — promote someone else first")
    store.set_admin(user_id, make)
    return {"ok": True}


@router.post("/users/active")
def set_active(body: dict, admin: dict = Depends(deps.require_admin)):
    user_id, active = int(body.get("user_id") or 0), bool(body.get("is_active"))
    user = store.get_user(user_id)
    if not user:
        raise HTTPException(404, "no such user")
    if not active and user["id"] == admin["id"]:
        raise HTTPException(400, "you cannot deactivate your own account")
    if not active and user["is_admin"] and store.admin_count() <= 1:
        raise HTTPException(400, "this is the only admin — promote someone else first")
    store.set_active(user_id, active)
    return {"ok": True}


def _abs_link(request: Request, path: str, token: str) -> str:
    """Build the link the admin will paste to someone else, honouring the
    proxy's host/scheme so it is the public URL and not http://127.0.0.1."""
    host = request.headers.get("x-forwarded-host") or request.headers.get("host", "")
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    base = f"{proto}://{host}" if host else str(request.base_url).rstrip("/")
    return f"{base}{path}?token={token}"
