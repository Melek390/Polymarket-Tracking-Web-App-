"""GET /api/favorite/{game_pk} — the Clear Favorite verdict for one game.

Prices and CLOB tokens come from the screener cache row (already refreshed
by the screener job), so the browser sends nothing but the gamePk."""

import json
import logging

from fastapi import APIRouter, HTTPException

from backend.database.db import get_db
from backend.favorite import engine

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/favorite", tags=["favorite"])


@router.get("/{game_pk}")
async def favorite(game_pk: int):
    with get_db() as conn:
        row = conn.execute(
            """SELECT home_team, away_team, home_price, away_price, token_ids
               FROM screener_cache WHERE sport='baseball' AND game_pk=?""",
            (game_pk,)).fetchone()
    if not row:
        raise HTTPException(404, "unknown baseball game")
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
    return result
