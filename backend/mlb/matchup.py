"""Pre-game / context panel for an MLB matchup: both teams' standings, their
season series, and the probable starters. Fetched on demand when a row is
expanded, with short caches so repeated expands cost nothing."""

import time
from datetime import datetime

from backend.mlb import client

_standings: dict = {"at": 0.0, "by_team": {}}
STANDINGS_TTL = 600  # standings move once a game, not once a second
_divisions: dict[int, str] = {}


async def _division_names() -> dict[int, str]:
    if not _divisions:
        try:
            r = await client._http().get(f"{client.BASE}/v1/divisions", params={"sportId": 1})
            r.raise_for_status()
            for d in r.json().get("divisions", []):
                _divisions[d["id"]] = d.get("nameShort") or d.get("name") or ""
        except Exception:
            pass
    return _divisions


async def _team_standings() -> dict[int, dict]:
    """{team id: standings row}, refreshed every STANDINGS_TTL seconds."""
    now = time.monotonic()
    if _standings["by_team"] and now - _standings["at"] < STANDINGS_TTL:
        return _standings["by_team"]
    season = datetime.now().year
    try:
        r = await client._http().get(
            f"{client.BASE}/v1/standings",
            params={"leagueId": "103,104", "season": season,
                    "standingsTypes": "regularSeason"},
        )
        r.raise_for_status()
        divisions = await _division_names()
        out: dict[int, dict] = {}
        for rec in r.json().get("records", []):
            div_id = (rec.get("division") or {}).get("id")
            for t in rec.get("teamRecords", []):
                splits = {s.get("type"): s for s in
                          (t.get("records", {}).get("splitRecords") or [])}

                def split(kind):
                    s = splits.get(kind)
                    return f"{s['wins']}-{s['losses']}" if s else None

                out[t["team"]["id"]] = {
                    "wins": t.get("wins"),
                    "losses": t.get("losses"),
                    "pct": t.get("winningPercentage"),
                    "division": divisions.get(div_id, ""),
                    "divisionRank": t.get("divisionRank"),
                    "gamesBack": t.get("gamesBack"),
                    # Standing beyond the division — already in this response,
                    # we were just dropping it. leagueRank is 1-15 within the
                    # AL/NL, sportRank is 1-30 across all of MLB.
                    "leagueRank": t.get("leagueRank"),
                    "sportRank": t.get("sportRank"),
                    "sportGamesBack": t.get("sportGamesBack"),
                    "streak": (t.get("streak") or {}).get("streakCode"),
                    "runDiff": t.get("runDifferential"),
                    "lastTen": split("lastTen"),
                    "homeRecord": split("home"),
                    "awayRecord": split("away"),
                }
        if out:
            _standings["by_team"] = out
            _standings["at"] = now
    except Exception:
        pass
    return _standings["by_team"]


async def _pitcher_seasons(ids: list[int]) -> dict[int, dict]:
    """Season ERA / W-L for the probable starters, in one call."""
    ids = [i for i in ids if i]
    if not ids:
        return {}
    try:
        r = await client._http().get(
            f"{client.BASE}/v1/people",
            params={"personIds": ",".join(str(i) for i in ids),
                    "hydrate": f"stats(group=[pitching],type=[season],season={datetime.now().year})"},
        )
        r.raise_for_status()
        out = {}
        for p in r.json().get("people", []):
            stat = {}
            for s in p.get("stats", []):
                for sp in s.get("splits", []):
                    stat = sp.get("stat", {}) or {}
            out[p["id"]] = {
                "era": stat.get("era"),
                "record": (f"{stat.get('wins')}-{stat.get('losses')}"
                           if stat.get("wins") is not None else None),
                "strikeOuts": stat.get("strikeOuts"),
                "inningsPitched": stat.get("inningsPitched"),
                "whip": stat.get("whip"),
            }
        return out
    except Exception:
        return {}


async def _season_series(away_id, home_id, away_name, home_name) -> str:
    """Head to head this season, as a sentence."""
    try:
        r = await client._http().get(
            f"{client.BASE}/v1/schedule",
            params={"sportId": 1, "season": datetime.now().year, "gameType": "R",
                    "teamId": away_id, "opponentId": home_id},
        )
        r.raise_for_status()
        aw = hm = 0
        for d in r.json().get("dates", []):
            for g in d.get("games", []):
                if g["status"]["abstractGameState"] != "Final":
                    continue
                t = g["teams"]
                if t["away"].get("isWinner"):
                    wid = t["away"]["team"]["id"]
                elif t["home"].get("isWinner"):
                    wid = t["home"]["team"]["id"]
                else:
                    continue
                aw += wid == away_id
                hm += wid == home_id
        if aw == 0 and hm == 0:
            return "First meeting of the season"
        if aw == hm:
            return f"Series tied {aw}-{hm}"
        leader, a, b = (away_name, aw, hm) if aw > hm else (home_name, hm, aw)
        return f"{leader} leads {a}-{b}"
    except Exception:
        return "N/A"


async def matchup(game_pk: int) -> dict:
    """Standings + season series + probable starters for one game."""
    r = await client._http().get(
        f"{client.BASE}/v1/schedule",
        params={"gamePk": game_pk, "hydrate": "probablePitcher,team"},
    )
    r.raise_for_status()
    games = [g for d in r.json().get("dates", []) for g in d.get("games", [])]
    if not games:
        return {}
    g = games[0]

    standings = await _team_standings()
    probables = {s: (g["teams"][s].get("probablePitcher") or {}) for s in ("away", "home")}
    seasons = await _pitcher_seasons([p.get("id") for p in probables.values()])

    def side(s):
        team = g["teams"][s]["team"]
        st = standings.get(team["id"], {})
        p = probables[s]
        return {
            "name": team.get("name"),
            "abbr": team.get("abbreviation"),
            **st,
            "probable": ({"name": p.get("fullName"), **seasons.get(p.get("id"), {})}
                         if p.get("fullName") else None),
        }

    away, home = side("away"), side("home")
    return {
        "away": away,
        "home": home,
        "series": await _season_series(
            g["teams"]["away"]["team"]["id"], g["teams"]["home"]["team"]["id"],
            away["name"], home["name"]),
        "venue": (g.get("venue") or {}).get("name"),
    }
