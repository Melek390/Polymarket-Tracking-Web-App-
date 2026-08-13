"""GET /api/favorite/{game_pk} — the Clear Favorite verdict for one game.

This endpoint READS ONLY. The verdict is produced in exactly one place — the
lock job, five minutes before first pitch — and served here unchanged for the
rest of time. Before that lock there is no score and this says so; it does not
compute a preview, because a number that moves is the thing the client
explicitly asked us to stop doing."""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from backend.database.db import get_db
from backend.favorite import lock
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

    # No lock: there is NO score, and we do not invent one.
    #
    # The client's rule is that the verdict is calculated once, five minutes
    # before first pitch, and stays put. So the engine runs in exactly one
    # place — the lock job — and never here. Before the lock there is nothing
    # to show; after a missed lock there is nothing valid to show, because the
    # only prices left are in-play ones and this is a pre-game model.
    #
    # Returning early also means no scoring work happens for the hundreds of
    # future games the screener carries.
    return {"game_pk": game_pk, "favorite": None,
            "away_name": row["away_team"], "home_name": row["home_team"],
            "locked": False,
            "pending": not _has_started(row["kickoff"]),
            "missed": _has_started(row["kickoff"]),
            "lock_minutes": lock.LOCK_MINUTES}


def _has_started(kickoff: str | None) -> bool:
    if not kickoff:
        return False
    return kickoff <= datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
