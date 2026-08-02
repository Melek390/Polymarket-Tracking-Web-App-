"""Server-side MLB live cache. One background job polls the light linescore
of every in-progress game on a short cycle; browsers read this cache instead
of hitting MLB directly, so our request rate stays fixed no matter how many
people are watching or how fast the page refreshes.

The per-row endpoint falls back to a *light* linescore fetch (~3 KB) on a
cache miss — never the 634 KB /feed/live — so a full slate of games can never
flood the single worker. The heavy feed is only ever used for the expand
panel's season stats (ERA / OPS)."""

import logging
import time
from datetime import datetime, timedelta, timezone

from backend.mlb import client

log = logging.getLogger(__name__)

_state: dict[int, dict] = {}          # gamePk -> compact live state
_state_at: dict[int, float] = {}      # gamePk -> monotonic time it was cached
_sched: dict[int, dict] = {}          # gamePk -> {away, home, status} for the day
_live = {"at": 0.0, "games": []}      # cached list of in-progress games
# Re-check the schedule this often. The game STATUS (Live/Final) comes from the
# schedule — the linescore has no completion flag — so this also caps how long
# a finished game keeps showing its last inning before flipping to "Final".
LIVE_LIST_TTL = 10
STATE_TTL = 4                         # a cached state is fresh enough for this long
# Bullpen usage (~8.5 KB boxscore) and home runs (~7 KB filtered playByPlay) are
# both heavier than the 3 KB linescore and both change rarely, so they refresh on
# their own slower cadence. MLB also only counts a reliever once he throws, 1-2
# min after the change is announced, so a faster cycle would buy nothing.
_pitchers: dict[int, dict] = {}       # gamePk -> {"away": n, "home": n}
_homers: dict[int, dict] = {}         # gamePk -> {"away": n, "home": n}
_slow_at: dict[int, float] = {}       # gamePk -> when we last refreshed both
SLOW_TTL = 20


async def _refresh_schedule() -> None:
    """Refresh the day's schedule: which games exist (names + status) and which
    are in progress. Cheap and cached for LIVE_LIST_TTL seconds."""
    now = time.monotonic()
    if _sched and now - _live["at"] <= LIVE_LIST_TTL:
        return
    today = datetime.now(timezone.utc)
    games: list[dict] = []
    for d in (today, today - timedelta(days=1)):
        try:
            games += await client.schedule(d.date().isoformat())
        except Exception as e:
            log.warning("MLB schedule fetch failed: %s", e)
    if games:
        for g in games:
            _sched[g["game_pk"]] = g
        _live["games"] = [g for g in games if g["status"] == "Live"]
        _live["at"] = now


async def poll() -> None:
    """Refresh the cached state of every live game (called on a timer)."""
    await _refresh_schedule()
    for g in _live["games"]:
        try:
            st = await client.linescore_state(
                g["game_pk"], g["away"], g["home"], g["status"], g.get("detailed")
            )
            # The linescore carries no pitch data, so the count alone can't show
            # a foul. This is a field-filtered ~0.5 KB call — smaller than the
            # linescore itself — and it is per LIVE game only.
            try:
                st["last_pitch"] = await client.last_pitch(g["game_pk"])
            except Exception as e:
                log.debug("MLB last_pitch %s failed: %s", g["game_pk"], e)
            # heavier, and both change at most a handful of times a game
            pk = g["game_pk"]
            if time.monotonic() - _slow_at.get(pk, 0.0) >= SLOW_TTL:
                try:
                    used = await client.pitchers_used(pk)
                    if used:
                        _pitchers[pk] = used
                except Exception as e:
                    log.debug("MLB pitchers_used %s failed: %s", pk, e)
                try:
                    hrs = await client.home_runs(pk)
                    if hrs is not None:
                        _homers[pk] = hrs
                except Exception as e:
                    log.debug("MLB home_runs %s failed: %s", pk, e)
                _slow_at[pk] = time.monotonic()
            st["pitchers"] = _pitchers.get(pk)
            st["home_runs"] = _homers.get(pk)
            _state[g["game_pk"]] = st
            _state_at[g["game_pk"]] = time.monotonic()
        except Exception as e:
            log.warning("MLB live poll %s failed: %s", g["game_pk"], e)


def cached(game_pk: int) -> dict | None:
    """The last cached state for a game, or None if it is not being polled."""
    return _state.get(game_pk)


async def light_state(game_pk: int) -> dict | None:
    """Cheap state for one game for the per-row endpoint: serve a fresh cache
    entry, else do ONE light linescore fetch (never the heavy feed) and cache
    it. Returns None only if we cannot resolve the game at all."""
    now = time.monotonic()
    st = _state.get(game_pk)
    if st is not None and now - _state_at.get(game_pk, 0.0) < STATE_TTL:
        return st

    if game_pk not in _sched:
        await _refresh_schedule()
    g = _sched.get(game_pk)
    # Not on today's/yesterday's slate but we've priced it before: refetch using
    # the names we already have rather than serving an indefinitely-stale entry.
    if g is None and st is not None:
        g = {"away": st["away"]["name"], "home": st["home"]["name"],
             "status": st.get("status") or "Live", "detailed": st.get("game_state")}
    if g is None:
        return st  # unknown game we've never seen — nothing to fetch
    try:
        st = await client.linescore_state(game_pk, g["away"], g["home"], g["status"], g.get("detailed"))
    except Exception as e:
        log.warning("MLB light_state %s failed: %s", game_pk, e)
        return _state.get(game_pk)
    _state[game_pk] = st
    _state_at[game_pk] = now
    return st
