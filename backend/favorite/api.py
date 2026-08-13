"""GET /api/favorite/{game_pk} — the Clear Favorite verdict for one game.

Prices and CLOB tokens come from the screener cache row (already refreshed
by the screener job), so the browser sends nothing but the gamePk."""

import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from backend.database.db import get_db
from backend.favorite import engine, lock
from backend.favorite import store as fav_store

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/favorite", tags=["favorite"])


@router.get("/{game_pk}")
async def favorite(game_pk: int):
    # A locked verdict is the answer, forever. It was taken ~5 minutes before
    # first pitch and is never recomputed, so nothing that happens during the
    # game — least of all the price — can move it.
    locked = fav_store.get(game_pk)
    if locked:
        return locked

    with get_db() as conn:
        row = conn.execute(
            """SELECT home_team, away_team, home_price, away_price, token_ids, kickoff
               FROM screener_cache WHERE sport='baseball' AND game_pk=?""",
            (game_pk,)).fetchone()
    if not row:
        raise HTTPException(404, "unknown baseball game")

    # First pitch has passed and no lock was ever taken. Do NOT score it: the
    # only prices available now are in-play ones, and feeding those to a
    # pre-game model is precisely the bug this replaces. Returning early also
    # means the in-play numbers are never computed, so they cannot leak into
    # the response for a client to render by accident.
    if _has_started(row["kickoff"]):
        return {"game_pk": game_pk, "favorite": None,
                "away_name": row["away_team"], "home_name": row["home_team"],
                "locked": False, "provisional": False, "missed": True,
                "lock_minutes": lock.LOCK_MINUTES}
    try:
        tokens = json.loads(row["token_ids"] or "[]")  # [row-home, row-away]
    except json.JSONDecodeError:
        tokens = []
    try:
        result = await engine.score_game(game_pk, {
            "home_team": row["home_team"], "away_team": row["away_team"],
            "home_price": row["home_price"], "away_price": row["away_price"],
            "home_token": tokens[0] if len(tokens) > 0 else None,
            "away_token": tokens[1] if len(tokens) > 1 else None,
        })
    except Exception as e:
        log.warning("favorite scoring %s failed: %s", game_pk, e)
        raise HTTPException(502, f"scoring failed: {e}")
    if result is None:
        raise HTTPException(404, "game not found on the MLB schedule")

    # Pre-game and not yet locked: a PROVISIONAL read that still moves with the
    # market and will be replaced by the real verdict at the lock.
    return {**result, "locked": False, "provisional": True, "missed": False,
            "lock_minutes": lock.LOCK_MINUTES}


def _has_started(kickoff: str | None) -> bool:
    if not kickoff:
        return False
    return kickoff <= datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
