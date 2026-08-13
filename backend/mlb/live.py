"""Server-side MLB live cache. One background job polls the light linescore
of every in-progress game on a short cycle; browsers read this cache instead
of hitting MLB directly, so our request rate stays fixed no matter how many
people are watching or how fast the page refreshes.

The per-row endpoint falls back to a *light* linescore fetch (~3 KB) on a
cache miss — never the 634 KB /feed/live — so a full slate of games can never
flood the single worker. The heavy feed is only ever used for the expand
panel's season stats (ERA / OPS)."""

import asyncio
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
_extras: dict[int, dict] = {}         # gamePk -> {walks, durations, duration_totals}
_slow_at: dict[int, float] = {}       # gamePk -> when we last refreshed both
SLOW_TTL = 20
POLL_CONCURRENCY = 8       # games refreshed in parallel


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


async def _poll_game(g: dict) -> None:
    """Refresh one live game. The linescore and the pitch go together every
    cycle; the two heavier counters ride the slower SLOW_TTL cadence."""
    pk = g["game_pk"]
    slow_due = time.monotonic() - _slow_at.get(pk, 0.0) >= SLOW_TTL

    # Everything this game needs, in flight at once rather than one after
    # another — a 15-game slate at ~300 ms a call cannot afford to be serial.
    jobs = [
        client.linescore_state(pk, g["away"], g["home"], g["status"], g.get("detailed")),
        client.last_pitch(pk),
    ]
    if slow_due:
        # one playByPlay fetch now feeds home runs AND the walks/duration rows
        jobs += [client.pitchers_used(pk), client.inning_extras(pk)]
    results = await asyncio.gather(*jobs, return_exceptions=True)

    st = results[0]
    if isinstance(st, Exception):
        log.warning("MLB live poll %s failed: %s", pk, st)
        return

    pitch = results[1]
    st["last_pitch"] = None if isinstance(pitch, Exception) else pitch
    if slow_due:
        used, ex = results[2], results[3]
        if not isinstance(used, Exception) and used:
            _pitchers[pk] = used
        if not isinstance(ex, Exception) and ex is not None:
            _homers[pk] = ex.pop("home_runs", None)
            _extras[pk] = ex
        _slow_at[pk] = time.monotonic()
    st["pitchers"] = _pitchers.get(pk)
    st["home_runs"] = _homers.get(pk)
    st["inning_extras"] = _extras.get(pk)
    _state[pk] = st
    _state_at[pk] = time.monotonic()


async def poll() -> None:
    """Refresh the cached state of every live game (called on a timer)."""
    await _refresh_schedule()
    games = _live["games"]
    if not games:
        return
    # Bounded so a full slate can't put 60 requests on the wire at once.
    sem = asyncio.Semaphore(POLL_CONCURRENCY)

    async def one(g):
        async with sem:
            try:
                await _poll_game(g)
            except Exception as e:
                log.warning("MLB live poll %s failed: %s", g.get("game_pk"), e)

    await asyncio.gather(*(one(g) for g in games))


def cached(game_pk: int) -> dict | None:
    """The last cached state for a game, or None if it is not being polled."""
    return _state.get(game_pk)


def schedule_status(game_pk: int) -> str | None:
    """The schedule's word on a game (Preview/Live/Final) — the linescore has
    no completion flag, so THIS is how a finished game is recognised. None =
    not on the cached two-day slate."""
    g = _sched.get(game_pk)
    return g["status"] if g else None


def live_states() -> list[tuple[int, dict]]:
    """(game_pk, cached state) for every in-progress game — the comeback
    detector's read path. Cache only: calling this costs no upstream request,
    so its consumer can run on any cadence without touching MLB."""
    return [(g["game_pk"], _state[g["game_pk"]])
            for g in _live["games"] if g["game_pk"] in _state]


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
    # walks/durations: finished games are static, so ONE playByPlay fetch per
    # process covers them; live games get refreshed by the poller anyway
    if game_pk not in _extras:
        try:
            ex = await client.inning_extras(game_pk)
            if ex is not None:
                _homers.setdefault(game_pk, ex.pop("home_runs", None))
                _extras[game_pk] = ex
        except Exception as e:
            log.warning("MLB inning_extras %s failed: %s", game_pk, e)
    st["pitchers"] = _pitchers.get(game_pk)
    st["home_runs"] = _homers.get(game_pk)
    st["inning_extras"] = _extras.get(game_pk)
    _state[game_pk] = st
    _state_at[game_pk] = now
    return st
