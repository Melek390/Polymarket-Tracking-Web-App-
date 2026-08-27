"""Oracle's Elixir read-only API (oe.datalisk.io).

This is the same JSON API oracleselixir.com's own front end calls, with the
public key it ships in its bundle. We use it exactly as the site does and no
harder: the whole app needs ~18 requests a DAY (one per active tournament),
cached in SQLite, so the load is negligible.

Scraping the rendered stats table was the alternative and it is strictly
worse — the page is a React app, so a restyle breaks the parse. The yearly
match-level CSVs are the fallback if this key is ever rotated; they are
hundreds of MB and would need aggregating ourselves.
"""
import logging

import httpx

from backend.offload import json_off_loop

log = logging.getLogger(__name__)

BASE = "https://oe.datalisk.io"
# public: shipped in oracleselixir.com's own JS bundle
API_KEY = "f561197a-82ea-4e54-acd2-386979018a7a"

_client: httpx.AsyncClient | None = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5.0, read=20.0, write=10.0, pool=5.0),
            headers={"X-Api-Key": API_KEY,
                     "Referer": "https://oracleselixir.com/",
                     "User-Agent": "polymarket-tracker/1.0 (team scorecards)"},
            limits=httpx.Limits(max_connections=4, keepalive_expiry=30.0))
    return _client


async def active_tournaments() -> list[dict]:
    """Every tournament with recent games, across ALL leagues.

    Each entry: {id, name, startDate, gamesPlayed, mostRecentGame}. The id is
    the path Oracle uses everywhere else, e.g. "LCK/2026 Season/Rounds 3-4".
    """
    r = await _http().get(f"{BASE}/tournaments/latest")
    r.raise_for_status()
    rows = await json_off_loop(r)
    return rows if isinstance(rows, list) else []


async def team_stats(tournament_id: str) -> list[dict]:
    """One row per team in the tournament, with the split-season aggregates:
    GP/W/L, AGT, GD15, FT%, F3T%, FD%, FBN% and more."""
    r = await _http().get(f"{BASE}/stats/teams/byTournament",
                          params={"tournament": tournament_id})
    r.raise_for_status()
    rows = await json_off_loop(r)
    return rows if isinstance(rows, list) else []
