"""The backfill: turns each tracked MLB game into backtest_spots rows, once.

Runs as a background job (a bounded batch per pass, so a full-corpus build is
a few passes) and can be kicked manually from the API. Per game:

  slug -> gamePk (screener's own match first, slug parsing second), then the
  postponement guard: the game's play timestamps must overlap the market's
  tick span, else the row is marked error rather than silently aligning May
  ticks with a July game (the mlb-tb-bos-2026-05-09 lesson).

Outcome sides are matched to MLB home/away BY NAME, the standing rule.
"""

import asyncio

import httpx
import logging
import re

from backend.backtest import replay, store
from backend.database.db import get_db
from backend.mlb import timeline

log = logging.getLogger(__name__)

MIN_TICKS = 1000
BATCH = 25                  # games per pass — a full corpus drains in ~14 passes
CONCURRENCY = 2             # polite to statsapi AND to our own event loop:
                            # each game also runs a tick-scan worker thread
GOLD_MAX_GAP_S = 10.0

_status = {"running": False, "last": None}


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _match_outcomes(market_id: int, home_name: str, away_name: str):
    """outcome ids for the MLB home/away sides, matched by team NAME."""
    with get_db() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT id, label FROM outcomes WHERE market_id=?", (market_id,))]
    ids = {}
    for side, name in (("home", home_name), ("away", away_name)):
        n = _norm(name)
        best = None
        for r in rows:
            ln = _norm(r["label"])
            if ln == n or ln in n or n in ln:
                best = r["id"]
                break
        ids[side] = best
    return ids if ids.get("home") and ids.get("away") and ids["home"] != ids["away"] else None


async def _one_game(g: dict):
    market_id, slug = g["market_id"], g["slug"]
    # a crash- or restart-interrupted attempt may have inserted spots without
    # ever writing its games row; without this a retry double-counts them
    store.clear_spots(market_id)
    pk = await timeline.resolve_game_pk(slug)
    if not pk:
        store.save_game(market_id, "error:no gamePk for slug", slug=slug)
        return

    from backend.favorite.data import game_info
    info = await game_info(pk)
    if not info:
        store.save_game(market_id, "error:game not on MLB schedule", slug=slug, game_pk=pk)
        return
    ids = _match_outcomes(market_id, info["home_name"], info["away_name"])
    if not ids:
        store.save_game(market_id, "error:outcome labels do not match team names",
                        slug=slug, game_pk=pk)
        return

    halves = await replay.halves(pk)
    if len(halves) < 4:
        # second time asking, long after the game must have ended: this one
        # really has no play-by-play, so stop re-queuing it
        again = g.get("prev_status") == store.RETRY_STATUS
        store.save_game(market_id,
                        "error:no play-by-play (confirmed)" if again
                        else store.RETRY_STATUS,
                        slug=slug, game_pk=pk)
        return

    # postponement guard: plays must overlap the ticks we actually hold
    with get_db() as conn:
        a0, b0 = replay.tick_span(conn, ids["home"])
    if not a0 or halves[-1]["ts"] < a0 or halves[0]["ts"] > b0:
        store.save_game(market_id, "error:plays outside tick span (postponed?)",
                        slug=slug, game_pk=pk)
        return

    with get_db() as conn:
        gap = replay.median_gap_seconds(conn, ids["home"], halves[0]["ts"], halves[-1]["ts"])
    gold = 1 if gap is not None and gap <= GOLD_MAX_GAP_S else 0

    spots = await replay.build_spots(market_id, pk, gold, ids,
                                     {"home": info["home_name"], "away": info["away_name"]})
    import json
    for s in spots:
        s["factors"] = json.dumps(s["factors"])
        s["path"] = json.dumps(s["path"])
    store.insert_spots(spots)
    store.save_game(market_id, "done", slug=slug, game_pk=pk, gold=gold,
                    mlb_home=info["home_name"], mlb_away=info["away_name"],
                    home_outcome_id=ids["home"], away_outcome_id=ids["away"],
                    spots=len(spots))
    log.info("backtest backfill: %s (%s) -> %d spots [%s]",
             slug, pk, len(spots), "gold" if gold else "silver")


async def run_batch(limit: int = BATCH) -> dict:
    """One pass. Safe to call repeatedly; finished games are never redone."""
    if _status["running"]:
        return {"running": True, **store.backfill_summary()}
    _status["running"] = True
    try:
        pending = store.games_pending(MIN_TICKS, limit)
        if pending:
            log.info("backtest backfill: %d game(s) this pass", len(pending))
        sem = asyncio.Semaphore(CONCURRENCY)

        async def one(g):
            async with sem:
                try:
                    await _one_game(g)
                except Exception as e:  # noqa: BLE001 — a bad game must not sink the batch
                    # some httpx errors stringify to '' — an unnamed
                    # "error:" wrote games off permanently during the Aug 23
                    # restarts; name the type, and let network hiccups retry
                    msg = str(e).strip() or type(e).__name__
                    if isinstance(e, (httpx.HTTPError, TimeoutError, OSError)):
                        stat = f"error:transient: {msg[:100]}"
                    else:
                        stat = f"error:{msg[:120]}"
                    log.warning("backtest backfill: %s failed: %s", g["slug"], msg)
                    store.save_game(g["market_id"], stat, slug=g["slug"])

        await asyncio.gather(*(one(g) for g in pending))
        _status["last"] = store.backfill_summary()
        return {"running": False, "batch": len(pending), **_status["last"]}
    finally:
        _status["running"] = False


def status() -> dict:
    return {"running": _status["running"],
            "pending": len(store.games_pending(MIN_TICKS, 10_000)),
            **store.backfill_summary()}
