"""HTTP surface for the accounts tracker. Mounted from main.py."""

import logging
import re

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from backend.auth import deps as auth_deps
from backend.traders import service, store

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/traders")

_ADDR = re.compile(r"0x[0-9a-fA-F]{40}")


class AddAccount(BaseModel):
    input: str          # a wallet address or any Polymarket profile URL
    label: str = ""


class TagToggle(BaseModel):
    asset: str
    tag: str


def _account_or_404(acct_id: int, request: Request | None = None) -> dict:
    """The account, if it exists AND the signed-in user may touch it: their
    own, or an unclaimed legacy row. Another user's account answers 404 -
    indistinguishable from not existing, so nothing leaks. No user on the
    request (healthcheck token, auth disabled in dev) means no restriction."""
    acct = store.get_account(acct_id)
    if not acct:
        raise HTTPException(404, "no such account")
    user = auth_deps.current_user(request) if request is not None else None
    if user and acct.get("owner_id") not in (None, user["id"]):
        raise HTTPException(404, "no such account")
    return acct


@router.get("")
async def list_accounts(request: Request):
    """The signed-in user's accounts only (plus unclaimed legacy rows), so
    each user sees and gets alerts for their own list - the client and his
    brother were seeing each other's."""
    user = auth_deps.current_user(request)
    return store.list_accounts(user["id"] if user else None)


@router.post("")
async def add_account(body: AddAccount, request: Request):
    """Accepts a raw address or a pasted profile URL — the address is parsed
    out of whatever arrives (name lookup is unreliable, V3.md limitation 4)."""
    m = _ADDR.search(body.input or "")
    if not m:
        raise HTTPException(422, "No wallet address found — paste the profile URL or the 0x… address")
    wallet = m.group(0).lower()
    label = (body.label or "").strip() or f"{wallet[:6]}…{wallet[-4:]}"
    user = auth_deps.current_user(request)
    acct = store.add_account(wallet, label, user["id"] if user else None)
    try:
        await service.sync_account(acct, force=True)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Polymarket unreachable: {e}")
    return acct


@router.delete("/{acct_id}")
async def delete_account(acct_id: int, request: Request):
    """Only the OWNER may delete. An unclaimed shared row is explicitly not
    deletable - one user deleting it would take it away from everyone (that
    happened Aug 24 and cost the client his tracked history). The delete
    itself is soft: re-adding the wallet brings everything back."""
    acct = _account_or_404(acct_id, request)
    user = auth_deps.current_user(request)
    if user and acct.get("owner_id") is None:
        raise HTTPException(409, "This is a shared legacy account. Add it to "
                            "your own list first (that claims it, history "
                            "included) - then you can remove it.")
    log.info("trader account delete: id=%s wallet=%s label=%r by user=%s",
             acct_id, acct.get("wallet"), acct.get("label"),
             (user or {}).get("username", "no-auth"))
    store.delete_account(acct_id)
    return {"ok": True}


@router.post("/{acct_id}/sync")
async def sync(acct_id: int, request: Request):
    acct = _account_or_404(acct_id, request)
    try:
        added = await service.sync_account(acct, force=True)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Polymarket unreachable: {e}")
    return {"added": added}


@router.get("/{acct_id}/summary")
async def summary(acct_id: int, request: Request):
    acct = _account_or_404(acct_id, request)
    try:
        await service.sync_account(acct)  # throttled — a no-op most of the time
        return await service.summary(acct)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Polymarket unreachable: {e}")


@router.get("/{acct_id}/open")
async def open_positions(acct_id: int, request: Request):
    acct = _account_or_404(acct_id, request)
    try:
        return await service.open_rows(acct)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Polymarket unreachable: {e}")


@router.get("/{acct_id}/closed")
async def closed_trades(acct_id: int, request: Request):
    acct = _account_or_404(acct_id, request)
    try:
        return await service.closed_rows(acct)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Polymarket unreachable: {e}")


@router.get("/{acct_id}/activity")
async def activity(acct_id: int, request: Request):
    acct = _account_or_404(acct_id, request)
    try:
        return await service.activity_rows(acct)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Polymarket unreachable: {e}")


@router.get("/{acct_id}/tags")
async def tag_vocab(acct_id: int, request: Request):
    """Distinct tags the account uses — merged with the fixed list client-side."""
    _account_or_404(acct_id, request)
    return store.all_tags(acct_id)


@router.post("/{acct_id}/tags")
async def toggle_tag(acct_id: int, body: TagToggle, request: Request):
    _account_or_404(acct_id, request)
    added = store.toggle_tag(acct_id, body.asset, body.tag.strip())
    return {"added": added}


@router.get("/peak")
async def peak(asset: str, after_ts: int):
    """Max price a token reached after a timestamp (the sold-too-early check).
    Lazy — called when a closed row is expanded, cached forever server-side."""
    try:
        return await service.peak_after(asset, after_ts) or {}
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Polymarket unreachable: {e}")
