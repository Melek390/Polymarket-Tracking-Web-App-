"""/api/backtest — for now, the corpus census.

"Eligible" = a tracked MLB market with real recorded ticks: exactly the games
a backtest can replay. The count comes from the tick_counts running totals —
one small row per outcome — so this never touches the multi-million-row ticks
table. MIN_TICKS weeds out markets that were tracked but never collected
anything meaningful (a pre-game click on a market that then got deleted);
the day-one audit found no genuine game under 5,000 ticks, so 1,000 is a
generous floor that only excludes junk.
"""

import asyncio
import time

from fastapi import APIRouter, HTTPException

from backend.backtest import backfill, bottom8history, engine, favhistory, store
from backend.database.db import get_db

router = APIRouter(prefix="/api/backtest", tags=["backtest"])


@router.get("/strategies")
def strategies():
    """The saved strategies with their params, plus the defaults the dialog's
    Restore button reverts to — one source of truth, server-side.

    Defaults are PER KIND: serving one set for every card meant Restore would
    have loaded comeback params into a favorite or tied-at-the-break card and
    changed what the strategy even is."""
    return {"strategies": store.strategies(),
            "defaults": store.DEFAULT_PARAMS,          # back-compat
            "defaultsByKind": {
                "comeback_replay": store.DEFAULT_PARAMS,
                "favorite_replay": store.FAVORITE_DEFAULTS,
                "bottom8_replay": store.BOTTOM8_DEFAULTS,
                "checklist": store.CHECKLIST_DEFAULTS,
            }}


@router.put("/strategies/{strategy_id}")
def save_strategy(strategy_id: int, body: dict):
    params = body.get("params")
    if not isinstance(params, dict):
        raise HTTPException(400, "params object required")
    if not store.save_params(strategy_id, params):
        raise HTTPException(404, "no such strategy")
    return {"ok": True}


@router.post("/run")
async def run(body: dict):
    """Arithmetic over the stored rows — milliseconds, no upstream calls.

    One exception: the tied-at-the-break strategy sweeps the last few days
    first, so pressing Run genuinely picks up games that finished since the
    previous run and puts them at the top of the list. The sweep is one
    request per day and hard-bounded, so the click stays a click."""
    params = body.get("params")
    if not isinstance(params, dict):
        raise HTTPException(400, "params object required")
    if params.get("kind") == "bottom8_replay":
        try:
            await bottom8history.catch_up()
        except Exception:  # noqa: BLE001 — a stale sweep must never block a run
            pass
    try:
        return engine.run(params, include_trades=bool(body.get("includeTrades")))
    except KeyError as e:
        raise HTTPException(400, f"missing param: {e}")


@router.post("/backfill")
async def kick_backfill():
    """Start one backfill pass in the background and return immediately."""
    if backfill.status()["running"]:
        return {"started": False, "reason": "already running", **backfill.status()}
    asyncio.get_event_loop().create_task(backfill.run_batch())
    return {"started": True}


@router.get("/backfill/status")
def backfill_status():
    return backfill.status()


@router.post("/favbackfill")
async def kick_favbackfill():
    """Reconstruct historical T-5 favorite verdicts, one batch."""
    if favhistory.status()["running"]:
        return {"started": False, **favhistory.status()}
    asyncio.get_event_loop().create_task(favhistory.run_batch())
    return {"started": True}


@router.post("/bottom8backfill")
async def kick_bottom8():
    """Sweep the season for games tied at a late-inning break, one batch."""
    if bottom8history.status()["running"]:
        return {"started": False, **bottom8history.status()}
    asyncio.get_event_loop().create_task(bottom8history.run_batch())
    return {"started": True}


@router.get("/bottom8backfill/status")
def bottom8_status():
    return bottom8history.status()


@router.get("/favbackfill/status")
def favbackfill_status():
    return favhistory.status()

MIN_TICKS = 1000
_cache: tuple[float, dict] | None = None
_TTL = 300  # the corpus grows a few games a day — five minutes is plenty fresh


@router.get("/corpus")
def corpus():
    global _cache
    now = time.monotonic()
    if _cache and now - _cache[0] < _TTL:
        return _cache[1]
    with get_db() as conn:
        row = conn.execute(
            """SELECT COUNT(*) AS games,
                      COALESCE(SUM(n), 0) AS ticks
               FROM (SELECT m.id, SUM(tc.n) AS n
                     FROM markets m
                     JOIN events e   ON e.id = m.event_id
                     JOIN outcomes o ON o.market_id = m.id
                     JOIN tick_counts tc ON tc.outcome_id = o.id
                     WHERE e.slug LIKE 'mlb-%'
                     GROUP BY m.id
                     HAVING SUM(tc.n) >= ?)""",
            (MIN_TICKS,)).fetchone()
        # The since-date has two traps, both hit on the way here:
        # markets.created_at was backfilled by a July migration with its own
        # run date ("since July 17"), and a global MIN(ts) catches settled-
        # market CLOB backfills whose history reaches back a YEAR ("since
        # July 2025"). So: earliest tick of the MLB outcomes themselves —
        # one (outcome_id, ts)-index seek per outcome, ~500 seeks, instant.
        first = conn.execute(
            """SELECT MIN((SELECT MIN(ts) FROM ticks t
                           WHERE t.outcome_id = o.id)) AS t
               FROM markets m
               JOIN events e   ON e.id = m.event_id
               JOIN outcomes o ON o.market_id = m.id
               WHERE e.slug LIKE 'mlb-%'""").fetchone()
    result = {
        "eligible_games": row["games"],
        "total_ticks": row["ticks"],
        "since": (first["t"] or "")[:10] or None,
        "min_ticks": MIN_TICKS,
    }
    _cache = (now, result)
    return result
