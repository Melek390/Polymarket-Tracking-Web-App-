"""/api/backtest — for now, the corpus census.

"Eligible" = a tracked MLB market with real recorded ticks: exactly the games
a backtest can replay. The count comes from the tick_counts running totals —
one small row per outcome — so this never touches the multi-million-row ticks
table. MIN_TICKS weeds out markets that were tracked but never collected
anything meaningful (a pre-game click on a market that then got deleted);
the day-one audit found no genuine game under 5,000 ticks, so 1,000 is a
generous floor that only excludes junk.
"""

import time

from fastapi import APIRouter

from backend.database.db import get_db

router = APIRouter(prefix="/api/backtest", tags=["backtest"])

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
        # NOT markets.created_at: a July migration backfilled that column with
        # its own run date, which put "since July 17" on a corpus whose ticks
        # demonstrably start May 4. MIN over the ts index is O(1) and honest
        # (first tick the tracker ever stored, any sport — same day the MLB
        # collection started).
        first = conn.execute("SELECT MIN(ts) AS t FROM ticks").fetchone()
    result = {
        "eligible_games": row["games"],
        "total_ticks": row["ticks"],
        "since": (first["t"] or "")[:10] or None,
        "min_ticks": MIN_TICKS,
    }
    _cache = (now, result)
    return result
