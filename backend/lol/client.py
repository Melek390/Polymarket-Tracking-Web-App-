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


async def all_tournaments() -> list[dict]:
    """EVERY tournament of every league, in one request (109 leagues, ~3k
    tournaments, ~0.5 MB).

    /tournaments/latest looked right but only lists tournaments played in the
    last couple of days — so the majors between splits (LEC, LPL, LCS, PCS,
    CBLOL...) were invisible and their matches got no scorecard. Enumerating
    and filtering by start date is one request and misses nothing.
    """
    r = await _http().get(f"{BASE}/tournaments/byLeague")
    r.raise_for_status()
    data = await json_off_loop(r)
    if not isinstance(data, dict):
        return []
    out = []
    for league, rows in data.items():
        for t in rows or []:
            if t.get("id"):
                out.append({**t, "league": t.get("league") or league})
    return out


async def recent_tournaments(days: int = 120) -> list[dict]:
    """Tournaments that started inside the window — i.e. the splits and
    playoffs currently being played, newest first. 120 days covers every
    major plus the regional leagues (105 tournaments in August 2026)."""
    from datetime import datetime, timedelta, timezone
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    rows = [t for t in await all_tournaments()
            if str(t.get("startDate") or "") >= cutoff]
    rows.sort(key=lambda t: str(t.get("startDate") or ""), reverse=True)
    return rows


async def team_stats(tournament_id: str) -> list[dict]:
    """One row per team in the tournament, with the split-season aggregates:
    GP/W/L, AGT, GD15, FT%, F3T%, FD%, FBN% and more."""
    r = await _http().get(f"{BASE}/stats/teams/byTournament",
                          params={"tournament": tournament_id})
    r.raise_for_status()
    rows = await json_off_loop(r)
    return rows if isinstance(rows, list) else []
