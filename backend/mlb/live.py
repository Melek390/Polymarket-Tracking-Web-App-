"""Server-side MLB live cache. One background job polls the light linescore
of every in-progress game on a short cycle; browsers read this cache instead
of hitting MLB directly, so our request rate stays fixed no matter how many
people are watching or how fast the page refreshes."""

import logging
import time
from datetime import datetime, timedelta, timezone

from backend.mlb import client

log = logging.getLogger(__name__)

_state: dict[int, dict] = {}          # gamePk -> compact live state
_live = {"at": 0.0, "games": []}      # cached list of in-progress games
LIVE_LIST_TTL = 30                    # re-check which games are live this often


async def _live_games() -> list[dict]:
    """Games currently in progress (today or a late game from yesterday)."""
    now = time.monotonic()
    if now - _live["at"] > LIVE_LIST_TTL:
        today = datetime.now(timezone.utc)
        games = []
        for d in (today, today - timedelta(days=1)):
            try:
                games += await client.schedule(d.date().isoformat())
            except Exception as e:
                log.warning("MLB schedule fetch failed: %s", e)
        _live["games"] = [g for g in games if g["status"] == "Live"]
        _live["at"] = now
    return _live["games"]


async def poll():
    """Refresh the cached state of every live game (called on a timer)."""
    for g in await _live_games():
        try:
            _state[g["game_pk"]] = await client.linescore_state(
                g["game_pk"], g["away"], g["home"], "Live"
            )
        except Exception as e:
            log.warning("MLB live poll %s failed: %s", g["game_pk"], e)


def cached(game_pk: int) -> dict | None:
    """The last cached state for a game, or None if it is not being polled."""
    return _state.get(game_pk)
