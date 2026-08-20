"""Season-wide record of games TIED at a late-inning break.

Same insight that unlocked the Clear Favorite history: this question needs no
tick data. Whether a game was level when the away side finished batting, and
who eventually won, is pure MLB record — so the corpus is every game of the
season rather than only the ones we were recording ticks for.

COST: MLB's schedule endpoint hydrates the full linescore, so ONE request
returns every game of a day with its inning-by-inning runs (~65 KB, ~15
games). A whole season is therefore ~150 requests, not one per game. Days are
marked done only when every game on them is final, so a day swept while games
were still in progress is revisited rather than frozen half-recorded.
"""

import asyncio
import logging

from backend.backtest import store
from backend.mlb import client

log = logging.getLogger(__name__)

SEASON_START = "2026-03-25"      # Opening Day, with a day of slack
CONCURRENCY = 3
# NOTE: the schedule's team object carries no abbreviation, however the fields
# are filtered — those come from the cached name->abbr map instead.
_FIELDS = ("dates,date,games,gamePk,gameType,status,abstractGameState,teams,"
           "away,home,team,name,linescore,innings,num,runs,currentInning")


def _mid(innings: dict, n: int) -> tuple[int, int] | None:
    """Cumulative (away, home) runs at the middle of inning `n` — the break
    after the away side has batted n times and the home side n-1.

    None when the game never got there, which is the honest answer for a
    game that ended early or was rained out."""
    if n not in innings or (innings[n].get("away") or {}).get("runs") is None:
        return None
    away = sum((innings[k].get("away") or {}).get("runs") or 0
               for k in range(1, n + 1) if k in innings)
    home = sum((innings[k].get("home") or {}).get("runs") or 0
               for k in range(1, n) if k in innings)
    return away, home


def _row(game: dict, abbr: dict[str, str] | None = None) -> dict | None:
    """One finished game -> a record, but only if it was tied at one of the
    breaks the strategy can ask about (7th/8th/9th). Anything else would be
    thousands of rows nothing ever reads."""
    ls = game.get("linescore") or {}
    innings = {i["num"]: i for i in ls.get("innings") or [] if i.get("num")}
    if not innings:
        return None
    mids = {n: _mid(innings, n) for n in (7, 8, 9)}
    if not any(m and m[0] == m[1] for m in mids.values()):
        return None

    teams = game.get("teams") or {}
    final_away = (ls.get("teams") or {}).get("away", {}).get("runs")
    final_home = (ls.get("teams") or {}).get("home", {}).get("runs")
    if final_away is None or final_home is None or final_away == final_home:
        return None      # a tie on the board means the game never finished
    away_t = (teams.get("away") or {}).get("team") or {}
    home_t = (teams.get("home") or {}).get("team") or {}
    abbr = abbr or {}
    away_name, home_name = away_t.get("name"), home_t.get("name")
    return {
        "game_pk": game["gamePk"],
        "game_date": game.get("_date"),
        "away_name": away_name, "home_name": home_name,
        "away_abbr": abbr.get(away_name), "home_abbr": abbr.get(home_name),
        "mid7_away": mids[7][0] if mids[7] else None,
        "mid7_home": mids[7][1] if mids[7] else None,
        "mid8_away": mids[8][0] if mids[8] else None,
        "mid8_home": mids[8][1] if mids[8] else None,
        "mid9_away": mids[9][0] if mids[9] else None,
        "mid9_home": mids[9][1] if mids[9] else None,
        "final_away": final_away, "final_home": final_home,
        "final_inning": ls.get("currentInning") or max(innings),
        "winner": "home" if final_home > final_away else "away",
    }


async def sweep_day(day: str) -> tuple[list[dict], bool]:
    """(rows, every game that day is final) — one request."""
    r = await client._http().get(
        f"{client.BASE}/v1/schedule",
        params={"sportId": 1, "date": day, "gameType": "R",
                "hydrate": "linescore", "fields": _FIELDS})
    r.raise_for_status()
    games = [g for d in r.json().get("dates", []) for g in d.get("games", [])]
    abbr = await client.team_abbreviations()   # cached after the first call
    rows, all_final = [], True
    for g in games:
        state = (g.get("status") or {}).get("abstractGameState")
        if state != "Final":
            if state == "Live":
                all_final = False
            continue
        g["_date"] = day
        row = _row(g, abbr)
        if row:
            rows.append(row)
    return rows, all_final


def _days(upto: str) -> list[str]:
    from datetime import date, timedelta
    start = date.fromisoformat(SEASON_START)
    end = date.fromisoformat(upto)
    out, d = [], start
    while d <= end:
        out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def _today() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).date().isoformat()


_status = {"running": False, "last_batch": 0}


async def run_batch(max_days: int = 40) -> dict:
    """Sweep days that are not finished yet, oldest first. Bounded so a first
    run drains the season over a few passes instead of one long stall."""
    if _status["running"]:
        return {"running": True}
    _status["running"] = True
    try:
        done = store.bottom8_days_done()
        todo = [d for d in _days(_today()) if d not in done][:max_days]
        _status["last_batch"] = len(todo)
        if not todo:
            return {"running": False, "days": 0}
        sem = asyncio.Semaphore(CONCURRENCY)

        async def one(day):
            async with sem:
                try:
                    rows, final = await sweep_day(day)
                except Exception as e:  # noqa: BLE001
                    log.warning("bottom8 history: %s failed: %s", day, e)
                    return
                store.save_bottom8(rows)
                store.mark_bottom8_day(day, final)

        await asyncio.gather(*(one(d) for d in todo))
        log.info("bottom8 history: swept %d day(s)", len(todo))
        return {"running": False, "days": len(todo)}
    finally:
        _status["running"] = False


async def catch_up(max_days: int = 5) -> int:
    """The small sweep a Run backtest triggers: pick up the days that have
    finished since the last pass so new games appear at the top of the list.
    Bounded hard — a click must stay a click."""
    done = store.bottom8_days_done()
    todo = [d for d in _days(_today()) if d not in done][-max_days:]
    for day in todo:
        try:
            rows, final = await sweep_day(day)
        except Exception as e:  # noqa: BLE001
            log.warning("bottom8 catch-up: %s failed: %s", day, e)
            continue
        store.save_bottom8(rows)
        store.mark_bottom8_day(day, final)
    return len(todo)


def status() -> dict:
    from backend.database.db import get_db
    with get_db() as conn:
        games = conn.execute("SELECT COUNT(*) c FROM backtest_bottom8").fetchone()["c"]
        days = conn.execute(
            "SELECT COUNT(*) c FROM backtest_bottom8_days WHERE done=1").fetchone()["c"]
    return {"running": _status["running"], "games": games, "days_done": days,
            "last_batch": _status["last_batch"]}
