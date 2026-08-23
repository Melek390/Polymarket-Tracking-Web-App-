"""Multi-season win-expectancy sweep — the fair-value strategy's history.

The client's question needs "teams trailing by D after inning N win X% of
the time" from MANY seasons of real results. Rather than scraping Baseball
Savant (no API, licensing unclear — flagged in the project notes), the
inning lines come from MLB's own schedule endpoint: one request returns a
whole day of games with runs per inning, so a season is ~200 requests and
the 2023-2026 span is a one-time ~800. The raw lines are stored per game
(backtest_we_games); the aggregated table is derived at query time, so a
definition change never needs a re-sweep.

Days are marked done only when every game on them is final; the current
season's tail is topped up by a 6h job plus a bounded catch-up when the
strategy's Run button is pressed.
"""

import asyncio
import json
import logging
from datetime import date, datetime, timedelta, timezone

from backend.backtest import store
from backend.mlb import client

log = logging.getLogger(__name__)

# Generous per-season windows (Seoul/international openers start mid-March;
# the regular season ends by early October). Empty days cost one tiny
# request once and are marked done forever.
SEASONS = (2023, 2024, 2025, 2026)
_SEASON_SPAN = ("03-15", "10-05")
CONCURRENCY = 3

_FIELDS = ("dates,date,games,gamePk,gameType,status,abstractGameState,teams,"
           "away,home,linescore,innings,num,runs")


def _line(game: dict) -> dict | None:
    """One finished game -> its stored row, or None when the linescore is
    unusable. Home entries where the side never batted stay None — the
    fair-value derivation must not invent a bottom half that never happened
    (walk-off wins end mid-inning)."""
    ls = game.get("linescore") or {}
    innings = sorted((i for i in ls.get("innings") or [] if i.get("num")),
                     key=lambda i: i["num"])
    if not innings:
        return None
    away = [(i.get("away") or {}).get("runs") for i in innings]
    home = [(i.get("home") or {}).get("runs") for i in innings]
    if away[0] is None:
        return None
    fa = (ls.get("teams") or {}).get("away", {}).get("runs")
    fh = (ls.get("teams") or {}).get("home", {}).get("runs")
    if fa is None or fh is None or fa == fh:
        return None                       # never finished / suspended
    day = game["_date"]
    return {
        "game_pk": game["gamePk"],
        "season": int(day[:4]),
        "game_date": day,
        "away_line": json.dumps(away),
        "home_line": json.dumps(home),
        "home_won": 1 if fh > fa else 0,
    }


async def sweep_day(day: str) -> tuple[list[dict], bool]:
    """(rows, every game that day is final) — one request."""
    r = await client._http().get(
        f"{client.BASE}/v1/schedule",
        params={"sportId": 1, "date": day, "gameType": "R",
                "hydrate": "linescore", "fields": _FIELDS})
    r.raise_for_status()
    games = [g for d in r.json().get("dates", []) for g in d.get("games", [])]
    rows, all_final = [], True
    for g in games:
        state = (g.get("status") or {}).get("abstractGameState")
        if state != "Final":
            if state == "Live":
                all_final = False
            continue
        g["_date"] = day
        row = _line(g)
        if row:
            rows.append(row)
    return rows, all_final


def _all_days() -> list[str]:
    today = datetime.now(timezone.utc).date()
    out = []
    for season in SEASONS:
        d = date.fromisoformat(f"{season}-{_SEASON_SPAN[0]}")
        end = min(date.fromisoformat(f"{season}-{_SEASON_SPAN[1]}"), today)
        while d <= end:
            out.append(d.isoformat())
            d += timedelta(days=1)
    return out


_status = {"running": False, "last_batch": 0}


async def run_batch(max_days: int = 60) -> dict:
    """Sweep unfinished days, oldest first, one bounded batch."""
    if _status["running"]:
        return {"running": True}
    _status["running"] = True
    try:
        done = store.we_days_done()
        todo = [d for d in _all_days() if d not in done][:max_days]
        _status["last_batch"] = len(todo)
        if not todo:
            return {"running": False, "days": 0}
        sem = asyncio.Semaphore(CONCURRENCY)

        async def one(day):
            async with sem:
                try:
                    rows, final = await sweep_day(day)
                except Exception as e:  # noqa: BLE001
                    log.warning("WE history: %s failed: %s", day, e)
                    return
                store.save_we_games(rows)
                store.mark_we_day(day, final)

        await asyncio.gather(*(one(d) for d in todo))
        log.info("WE history: swept %d day(s)", len(todo))
        return {"running": False, "days": len(todo)}
    finally:
        _status["running"] = False


async def catch_up(max_days: int = 5) -> int:
    """The bounded top-up a strategy Run triggers: the current season's most
    recent unfinished days, so fresh results join the fair table."""
    done = store.we_days_done()
    todo = [d for d in _all_days() if d not in done][-max_days:]
    for day in todo:
        try:
            rows, final = await sweep_day(day)
        except Exception as e:  # noqa: BLE001
            log.warning("WE catch-up: %s failed: %s", day, e)
            continue
        store.save_we_games(rows)
        store.mark_we_day(day, final)
    if todo:
        store._fair_memo.clear()          # fresh games must reach the table
    return len(todo)


def status() -> dict:
    return {"running": _status["running"],
            "seasons": store.we_seasons(),
            "days_done": len(store.we_days_done()),
            "days_total": len(_all_days()),
            "last_batch": _status["last_batch"]}
