"""REST API — thin handlers over db/gamma/scheduler, contract from spec 5.2."""

import asyncio
import json
import re

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from backend.collector import backfill, scheduler
from backend.config.settings import settings
from backend.database import db
from backend.models.schemas import (
    LookupRequest,
    MarketPatch,
    ScreenerRequest,
    TrackRequest,
)
from backend.mlb import client as mlb
from backend.mlb import live as mlb_live
from backend.mlb import analyze as mlb_analyze_mod
from backend.mlb import timeline as mlb_timeline_mod
from backend.polymarket import clob, gamma
from backend.screener import screener as market_screener
from backend.screener import live_prices

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


@router.get("/screener/markets")
def screener_markets(sport: str = "soccer"):
    """Cached matches for the screener page, plus the league list."""
    rows = db.screener_rows(sport)
    for r in rows:
        r["condition_ids"] = json.loads(r["condition_ids"])
    return {
        "rows": rows,
        "leagues": sorted({r["league"] for r in rows}),
        "updated_at": rows[0]["updated_at"] if rows else None,
    }


@router.get("/screener/live-price")
async def screener_live_price(slug: str):
    """Live best-ask prices for one cached game. Served from the server-side
    live-price cache (refreshed every couple seconds by a background poller),
    so a browser can poll as fast as it likes without each request hitting the
    CLOB. First view of a game does one on-demand fetch to fill the cache."""
    live_prices.request(slug)
    hit = live_prices.cached(slug, max_age=8)
    if hit is not None:
        return hit
    try:
        return await live_prices.fetch_now(slug)
    except httpx.HTTPError:
        return {}


@router.get("/mlb/game/{game_pk}")
async def mlb_game(game_pk: int, full: bool = False):
    """Live MLB game state. Serves the server-side cache (refreshed every few
    seconds) so browsers never hit MLB directly; full=1 fetches the heavy feed
    for the expand panel's season stats (ERA / OPS)."""
    if not full:
        # Serve the shared cache, or a LIGHT linescore fetch on a miss — NEVER
        # the 634 KB feed. Return whatever light_state gives (None -> null, i.e.
        # "no live data", handled by the UI as the scheduled time). Falling
        # through to the heavy feed here floods the single worker.
        try:
            return await mlb_live.light_state(game_pk)
        except httpx.HTTPError as e:
            raise HTTPException(502, f"MLB API unreachable: {e}")
    # full=1 only (expand panel's season stats) uses the heavy feed
    try:
        return await mlb.live_game(game_pk)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"MLB API unreachable: {e}")


@router.get("/mlb/analyze/{game_pk}")
async def mlb_analyze(game_pk: int):
    """A ready-to-paste text snapshot of a game (score, situation, lineup,
    records, weather) for the Analyze button. Built on demand from the full
    feed, so it's not on any polling path."""
    try:
        return {"text": await mlb_analyze_mod.analyze_text(game_pk)}
    except httpx.HTTPError as e:
        raise HTTPException(502, f"MLB API unreachable: {e}")


@router.get("/mlb/timeline")
async def mlb_timeline(slug: str):
    """Play-by-play timeline (inning + pitcher + batter per timestamp) for a
    market's MLB game, so the price chart can show game state under the cursor.
    Empty when the slug isn't an MLB game we can resolve."""
    if not slug.startswith("mlb-"):
        return {"game_pk": None, "plays": []}
    try:
        pk = await mlb_timeline_mod.resolve_game_pk(slug)
        if not pk:
            return {"game_pk": None, "plays": []}
        return {"game_pk": pk, **await mlb_timeline_mod.play_timeline(pk)}
    except httpx.HTTPError:
        return {"game_pk": None, "plays": []}


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
    # MLB games get 1s price sampling so the feed-lag measurement has the
    # resolution it needs (see settings.mlb_poll_interval).
    interval = (settings.mlb_poll_interval
                if event["slug"].startswith("mlb-") else None)
    market_ids = [
        db.add_market(event_id, m["condition_id"], m["question"], m["kind"],
                      m["outcomes"], poll_interval=interval)
        for m in event["markets"]
        if m["condition_id"] in body.market_condition_ids
    ]
    if not market_ids:
        raise HTTPException(400, "no matching markets in that event")

    scheduler.sync_jobs()
    # A market Polymarket has already resolved stays closed — re-tracking it is
    # a no-op, so tell the caller which ones those were.
    closed_ids = db.closed_among(market_ids)
    # Pull all available history in the background; live polling starts now.
    # Settled markets are backfilled too — their history is the whole point of
    # tracking one, even though no new ticks will follow.
    for market_id in market_ids:
        asyncio.create_task(backfill.backfill_market(market_id))
    return {"market_ids": market_ids, "closed_market_ids": closed_ids}


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
            cells = (f"{prices[l]:.2f}" if l in prices else "" for l in labels)
            yield f"{ts}," + ",".join(cells) + "\r\n"

    # filename: market name + the date it was added, so repeat fixtures stay unique
    name = re.sub(
        r"[^A-Za-z0-9]+", "-", f"{market['event_title']} {market['question']}"
    ).strip("-").lower()[:80] or f"market-{market_id}"
    name += f"-{market['created_at'][:10]}"

    return StreamingResponse(
        rows(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{name}.csv"'},
    )
