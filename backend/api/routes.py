"""REST API — thin handlers over db/gamma/scheduler, contract from spec 5.2."""

import asyncio
import re

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from backend.collector import backfill, scheduler
from backend.database import db
from backend.models.schemas import (
    LookupRequest,
    MarketPatch,
    ScreenerRequest,
    TrackRequest,
)
from backend.polymarket import gamma
from backend.screener import screener as market_screener

router = APIRouter(prefix="/api")


def _market_or_404(market_id: int) -> dict:
    """Fetch a market or bail out with a 404."""
    market = db.get_market(market_id)
    if not market:
        raise HTTPException(404, f"market {market_id} not found")
    return market


@router.get("/dashboard")
def dashboard():
    """Numbers for the four dashboard cards."""
    return db.dashboard_stats()


@router.get("/markets")
def list_markets():
    """Every market with its outcomes, record count and sparkline."""
    return db.list_markets()


@router.post("/events/lookup")
async def lookup_event(body: LookupRequest):
    """Find an event on Polymarket from a pasted URL or ID (nothing saved yet)."""
    try:
        event = await gamma.lookup_event(body.url_or_slug)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Polymarket unreachable: {e}")
    if not event:
        raise HTTPException(404, "no event found for that URL or ID")
    return event


@router.post("/screener")
async def screen_markets(body: ScreenerRequest):
    """Search live markets: 'sport, prop text, side < price'."""
    try:
        results = await market_screener.screen(body.query)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Polymarket unreachable: {e}")
    if results is None:
        sports = ", ".join(sorted(set(market_screener.SPORT_TAGS)))
        raise HTTPException(400, f"unknown sport — start your search with one of: {sports}")
    return results


@router.post("/events/track")
async def track_event(body: TrackRequest):
    """Save the props the user ticked and start polling them."""
    try:
        event = await gamma.lookup_event(body.slug)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Polymarket unreachable: {e}")
    if not event:
        raise HTTPException(404, "event no longer available")

    event_id = db.upsert_event(event["slug"], event["title"])
    market_ids = [
        db.add_market(event_id, m["condition_id"], m["question"], m["kind"], m["outcomes"])
        for m in event["markets"]
        if m["condition_id"] in body.market_condition_ids
    ]
    if not market_ids:
        raise HTTPException(400, "no matching markets in that event")

    scheduler.sync_jobs()
    # pull all available 1-min history in the background; live polling starts now
    for market_id in market_ids:
        asyncio.create_task(backfill.backfill_market(market_id))
    return {"market_ids": market_ids}


@router.post("/markets/{market_id}/start")
def start_market(market_id: int):
    """Resume polling for a market."""
    market = _market_or_404(market_id)
    if market["closed"]:
        raise HTTPException(400, "market is closed on Polymarket — no more data exists")
    db.set_tracking(market_id, True)
    scheduler.sync_jobs()
    return {"id": market_id, "tracking": True}


@router.post("/markets/{market_id}/stop")
def stop_market(market_id: int):
    """Pause polling for a market; its data is kept."""
    _market_or_404(market_id)
    db.set_tracking(market_id, False)
    scheduler.sync_jobs()
    return {"id": market_id, "tracking": False}


@router.get("/markets/{market_id}/ticks")
def market_ticks(market_id: int, limit: int = 500, before: str | None = None):
    """Paged time-series rows for the chart and the ticks table."""
    _market_or_404(market_id)
    return db.get_ticks(market_id, limit=limit, before=before)


@router.patch("/markets/{market_id}")
def patch_market(market_id: int, body: MarketPatch):
    """Change a market's poll interval."""
    _market_or_404(market_id)
    db.set_poll_interval(market_id, body.poll_interval)
    scheduler.sync_jobs()
    return db.get_market(market_id)


@router.delete("/markets/{market_id}")
def delete_market(market_id: int):
    """Permanently delete a market and every stored tick — irreversible."""
    _market_or_404(market_id)
    db.delete_market(market_id)
    scheduler.sync_jobs()
    return {"deleted": market_id}


@router.get("/markets/{market_id}/export.csv")
def export_csv(market_id: int):
    """Stream the full price history as a CSV download."""
    market = _market_or_404(market_id)
    labels = [o["label"] for o in market["outcomes"]]

    def rows():
        yield "timestamp," + ",".join(f"{label}_price" for label in labels) + "\r\n"
        for ts, prices in db.iter_ticks(market_id):
            cells = (f"{prices[l]:.3f}" if l in prices else "" for l in labels)
            yield f"{ts}," + ",".join(cells) + "\r\n"

    # filename from the market name: "spain-vs-argentina-will-spain-win.csv"
    name = re.sub(
        r"[^A-Za-z0-9]+", "-", f"{market['event_title']} {market['question']}"
    ).strip("-").lower()[:80] or f"market-{market_id}"

    return StreamingResponse(
        rows(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{name}.csv"'},
    )
