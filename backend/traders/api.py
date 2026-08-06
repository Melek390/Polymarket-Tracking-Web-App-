"""HTTP surface for the accounts tracker. Mounted from main.py."""

import re

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.traders import service, store

router = APIRouter(prefix="/api/traders")

_ADDR = re.compile(r"0x[0-9a-fA-F]{40}")


class AddAccount(BaseModel):
    input: str          # a wallet address or any Polymarket profile URL
    label: str = ""


class TagToggle(BaseModel):
    asset: str
    tag: str


def _account_or_404(acct_id: int) -> dict:
    acct = store.get_account(acct_id)
    if not acct:
        raise HTTPException(404, "no such account")
    return acct


@router.get("")
async def list_accounts():
    return store.list_accounts()


@router.post("")
async def add_account(body: AddAccount):
    """Accepts a raw address or a pasted profile URL — the address is parsed
    out of whatever arrives (name lookup is unreliable, V3.md limitation 4)."""
    m = _ADDR.search(body.input or "")
    if not m:
        raise HTTPException(422, "No wallet address found — paste the profile URL or the 0x… address")
    wallet = m.group(0).lower()
    label = (body.label or "").strip() or f"{wallet[:6]}…{wallet[-4:]}"
    acct = store.add_account(wallet, label)
    try:
        await service.sync_account(acct, force=True)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Polymarket unreachable: {e}")
    return acct


@router.delete("/{acct_id}")
async def delete_account(acct_id: int):
    _account_or_404(acct_id)
    store.delete_account(acct_id)
    return {"ok": True}


@router.post("/{acct_id}/sync")
async def sync(acct_id: int):
    acct = _account_or_404(acct_id)
    try:
        added = await service.sync_account(acct, force=True)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Polymarket unreachable: {e}")
    return {"added": added}


@router.get("/{acct_id}/summary")
async def summary(acct_id: int):
    acct = _account_or_404(acct_id)
    try:
        await service.sync_account(acct)  # throttled — a no-op most of the time
        return await service.summary(acct)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Polymarket unreachable: {e}")


@router.get("/{acct_id}/open")
async def open_positions(acct_id: int):
    acct = _account_or_404(acct_id)
    try:
        return await service.open_rows(acct)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Polymarket unreachable: {e}")


@router.get("/{acct_id}/closed")
async def closed_trades(acct_id: int):
    acct = _account_or_404(acct_id)
    try:
        return await service.closed_rows(acct)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Polymarket unreachable: {e}")


@router.get("/{acct_id}/activity")
async def activity(acct_id: int):
    acct = _account_or_404(acct_id)
    try:
        return await service.activity_rows(acct)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Polymarket unreachable: {e}")


@router.post("/{acct_id}/tags")
async def toggle_tag(acct_id: int, body: TagToggle):
    _account_or_404(acct_id)
    added = store.toggle_tag(acct_id, body.asset, body.tag.strip())
    return {"added": added}
