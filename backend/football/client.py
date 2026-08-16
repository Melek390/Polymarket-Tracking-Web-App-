"""API-FOOTBALL (api-sports.io v3) — one shared client, same house rules as
the MLB module: a single AsyncClient per process, browsers never trigger
upstream calls, and every fetch is filtered to exactly what we need.

The key comes from FOOTBALL_API_KEY in .env. Without a key every call
returns empty and logs once — the app runs fine, the soccer features just
stay dark until the key lands.

Quota note (why the polling is gated the way it is in live.py): the free
tier is 100 requests/day, 10/minute; paid tiers raise that a lot. We only
poll while a big-5 match is actually inside its live window, so quiet days
cost zero requests.
"""

import logging

import httpx

from backend.config.settings import settings

log = logging.getLogger(__name__)

BASE = "https://v3.football.api-sports.io"

# The five leagues in the client's spec, by API-FOOTBALL league id.
LEAGUES = {
    39: "Premier League",
    78: "Bundesliga",
    140: "La Liga",
    135: "Serie A",
    61: "Ligue 1",
}

_client: httpx.AsyncClient | None = None
_warned_no_key = False


def has_key() -> bool:
    return bool(settings.football_api_key)


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=settings.http_timeout,
            headers={"x-apisports-key": settings.football_api_key})
    return _client


async def _get(path: str, params: dict) -> list:
    """One API-FOOTBALL call -> its `response` list ([] on any problem —
    callers treat empty as 'no data right now', never as an exception)."""
    global _warned_no_key
    if not has_key():
        if not _warned_no_key:
            log.warning("football: FOOTBALL_API_KEY not set — soccer live "
                        "data and the 0-0 alert are OFF until it is")
            _warned_no_key = True
        return []
    try:
        r = await _http().get(f"{BASE}{path}", params=params)
        r.raise_for_status()
        body = r.json()
        errs = body.get("errors")
        if errs and (errs if isinstance(errs, list) else list(errs.values())):
            log.warning("football: API error on %s: %s", path, errs)
            return []
        return body.get("response") or []
    except (httpx.HTTPError, ValueError) as e:
        log.warning("football: %s failed: %s", path, e)
        return []


async def live_fixtures() -> list[dict]:
    """Every big-5 fixture currently live, in ONE request. The `live` param
    takes dash-separated league ids, but the API was observed (Aug 16)
    returning ALL ~95 worldwide live fixtures despite it — so the big-5
    filter is ENFORCED here and the param is just a hint."""
    rows = await _get("/fixtures", {"live": "-".join(str(i) for i in LEAGUES)})
    out = []
    for f in rows:
        fx, lg = f.get("fixture") or {}, f.get("league") or {}
        if lg.get("id") not in LEAGUES:
            continue
        teams, goals = f.get("teams") or {}, f.get("goals") or {}
        status = fx.get("status") or {}
        out.append({
            "fixture_id": fx.get("id"),
            "kickoff": fx.get("date"),
            "status": status.get("short"),          # 1H HT 2H ET P FT …
            "elapsed": status.get("elapsed"),       # minutes
            "league_id": lg.get("id"),
            "league": LEAGUES.get(lg.get("id"), lg.get("name")),
            "home": (teams.get("home") or {}).get("name"),
            "away": (teams.get("away") or {}).get("name"),
            "home_goals": goals.get("home"),
            "away_goals": goals.get("away"),
        })
    return [f for f in out if f["fixture_id"]]


def _stat_int(v):
    """API-FOOTBALL stats mix ints, nulls and '58%' strings."""
    if v is None:
        return None
    try:
        return int(str(v).rstrip("%"))
    except ValueError:
        return None


async def fixture_statistics(fixture_id: int) -> dict | None:
    """{home: {...}, away: {...}} with possession / shots / shots on target /
    red cards — the exact fields the client asked to see. None until the
    provider has stats for the match (they appear a few minutes in)."""
    rows = await _get("/fixtures/statistics", {"fixture": fixture_id})
    if len(rows) != 2:
        return None
    out = {}
    for side, team_row in zip(("home", "away"), rows):
        stats = {s.get("type"): s.get("value")
                 for s in team_row.get("statistics") or []}
        out[side] = {
            "team": (team_row.get("team") or {}).get("name"),
            "possession_pct": _stat_int(stats.get("Ball Possession")),
            "shots": _stat_int(stats.get("Total Shots")),
            "shots_on_target": _stat_int(stats.get("Shots on Goal")),
            "red_cards": _stat_int(stats.get("Red Cards")) or 0,
        }
    return out


async def fixture_final(fixture_id: int) -> dict | None:
    """Final score for one fixture (outcome recording after a trigger)."""
    rows = await _get("/fixtures", {"id": fixture_id})
    if not rows:
        return None
    f = rows[0]
    status = (f.get("fixture") or {}).get("status") or {}
    goals = f.get("goals") or {}
    return {"status": status.get("short"),
            "home_goals": goals.get("home"), "away_goals": goals.get("away")}
