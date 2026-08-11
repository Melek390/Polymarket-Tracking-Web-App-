"""Pre-game / context panel for an MLB matchup: both teams' standings, their
season series, and the probable starters. Fetched on demand when a row is
expanded, with short caches so repeated expands cost nothing."""

import asyncio
import time
from datetime import datetime, timedelta

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


_form_cache: dict[int, tuple[float, dict]] = {}
FORM_TTL = 3600  # results change at most once a game


async def _team_form(team_id: int, n: int = 3) -> dict:
    """The team's recent form from one schedule fetch (client, Aug 11):
    - "series": last n COMPLETED series, newest first — res/wins/losses plus
      home-or-away and the opponent (abbr for display, full name for hover).
      Consecutive final games vs the same opponent form a series; it counts
      only once its final scheduled game was played (seriesGameNumber ==
      gamesInSeries), so the series in progress is never shown half-done.
    - "lastTen": the last 10 games as "W"/"L", NEWEST FIRST."""
    now = time.monotonic()
    hit = _form_cache.get(team_id)
    if hit and now - hit[0] < FORM_TTL:
        return hit[1]
    end = datetime.now()
    try:
        r = await client._http().get(
            f"{client.BASE}/v1/schedule",
            params={"sportId": 1, "teamId": team_id, "gameType": "R",
                    "startDate": (end - timedelta(days=35)).date().isoformat(),
                    "endDate": end.date().isoformat()})
        r.raise_for_status()
        abbrs = await client.team_abbreviations()  # full name -> abbr
        finals = []
        for d in r.json().get("dates", []):
            for g in d.get("games", []):
                if g["status"]["abstractGameState"] != "Final":
                    continue
                t = g["teams"]
                mine = "home" if t["home"]["team"]["id"] == team_id else "away"
                opp = t["away" if mine == "home" else "home"]["team"]
                opp_name = opp.get("name") or ""
                finals.append({
                    "opp_id": opp["id"], "opp": opp_name,
                    "opp_abbr": abbrs.get(opp_name) or opp_name[:3].upper(),
                    "home": mine == "home",
                    "won": bool(t[mine].get("isWinner")),
                    "series_num": g.get("seriesGameNumber"),
                    "in_series": g.get("gamesInSeries"),
                })
        groups: list[dict] = []
        for f in finals:  # already in date order
            if not groups or groups[-1]["opp_id"] != f["opp_id"]:
                groups.append({"opp_id": f["opp_id"], "games": []})
            groups[-1]["games"].append(f)
        series = []
        for grp in reversed(groups):  # newest first, as the client reads
            last = grp["games"][-1]
            if (last["series_num"] is not None and last["in_series"] is not None
                    and last["series_num"] != last["in_series"]):
                continue  # series not finished (in progress or postponed tail)
            wins = sum(g["won"] for g in grp["games"])
            losses = len(grp["games"]) - wins
            first = grp["games"][0]
            series.append({"res": "W" if wins > losses else "L" if losses > wins else "T",
                           "wins": wins, "losses": losses,
                           "opponent": first["opp"], "opp_abbr": first["opp_abbr"],
                           "home": first["home"]})
            if len(series) == n:
                break
        form = {"series": series,
                "lastTen": ["W" if f["won"] else "L" for f in finals[-10:]][::-1]}
        _form_cache[team_id] = (now, form)
        return form
    except Exception:
        return hit[1] if hit else {"series": [], "lastTen": []}


# gamePk -> (cached_at, {side: {"ids", "names", "pos", "sp"}}). A finished
# game's lineup is immutable (ttl=None); today's re-checks every 5 min so a
# late scratch or the confirmed lineup replacing "not available" shows up.
_lineup_cache: dict[int, tuple[float | None, dict]] = {}
_prev_cache: dict[int, tuple[float, tuple | None]] = {}  # team -> (at, (pk, side))
PREV_TTL = 1800
LINEUP_TTL = 300


async def _game_lineups(game_pk: int, immutable: bool) -> dict[str, dict]:
    """Starting lineups of one game, both sides. Starters are the players
    whose battingOrder is a multiple of 100 (100..900) — substitutes get
    e.g. 401 and never count. The first pitcher listed is the starter."""
    hit = _lineup_cache.get(game_pk)
    if hit and (hit[0] is None or time.monotonic() - hit[0] < LINEUP_TTL):
        return hit[1]
    r = await client._http().get(f"{client.BASE}/v1/game/{game_pk}/boxscore")
    r.raise_for_status()
    box = r.json()
    out: dict[str, dict] = {}
    for side in ("away", "home"):
        t = box.get("teams", {}).get(side, {})
        starters = []
        for p in (t.get("players") or {}).values():
            order = str(p.get("battingOrder", ""))
            if order.isdigit() and int(order) % 100 == 0:
                starters.append((int(order), p))
        starters.sort()
        out[side] = {
            "ids": [p["person"]["id"] for _, p in starters],
            "names": {p["person"]["id"]: p["person"].get("fullName") for _, p in starters},
            "pos": {p["person"]["id"]: (p.get("position") or {}).get("abbreviation") or ""
                    for _, p in starters},
            "sp": (t.get("pitchers") or [None])[0],
        }
    _lineup_cache[game_pk] = (None if immutable else time.monotonic(), out)
    return out


async def _prev_final(team_id: int, before_pk: int) -> tuple | None:
    """(gamePk, side) of the team's most recent FINISHED game."""
    now = time.monotonic()
    hit = _prev_cache.get(team_id)
    if hit and now - hit[0] < PREV_TTL:
        return hit[1]
    end = datetime.now()
    r = await client._http().get(
        f"{client.BASE}/v1/schedule",
        params={"sportId": 1, "teamId": team_id, "gameType": "R",
                "startDate": (end - timedelta(days=12)).date().isoformat(),
                "endDate": end.date().isoformat()})
    r.raise_for_status()
    result = None
    for d in r.json().get("dates", []):
        for g in d.get("games", []):
            if g["gamePk"] == before_pk or g["status"]["abstractGameState"] != "Final":
                continue
            side = "home" if g["teams"]["home"]["team"]["id"] == team_id else "away"
            result = (g["gamePk"], side)  # dates are ascending: keep the last
    _prev_cache[team_id] = (now, result)
    return result


async def _lineup_diff(team_id: int, game_pk: int, side: str) -> dict:
    """How today's starting nine differs from the team's previous game.
    PERSONNEL continuity only (client spec): batting-order or defensive-
    position moves don't count as changes, and the SP is reported separately
    and excluded from the percentage."""
    out: dict = {"status": "none", "sp_prev": None}
    try:
        prev = await _prev_final(team_id, game_pk)
        prev_lu: dict = {}
        prev_nine: list = []
        if prev:
            prev_lu = (await _game_lineups(prev[0], immutable=True)).get(prev[1]) or {}
            prev_nine = prev_lu.get("ids") or []
            if prev_lu.get("sp"):
                era = (await _pitcher_seasons([prev_lu["sp"]])).get(prev_lu["sp"], {}).get("era")
                name = await _person_name(prev_lu["sp"])
                out["sp_prev"] = {"name": name, "era": era}
        today = (await _game_lineups(game_pk, immutable=False)).get(side) or {}
        nine = today.get("ids") or []
        if not nine or not prev_nine:
            return out  # no lineup yet (or no previous game) — nothing to compare
        returning = [i for i in nine if i in prev_nine]
        out.update({
            "status": "confirmed",  # MLB only publishes official lineups
            "returning": len(returning),
            "total": len(nine),
            "pct": round(len(returning) / len(nine) * 100),
            "ins": [{"name": today["names"].get(i), "pos": today["pos"].get(i)}
                    for i in nine if i not in prev_nine],
            "outs": [{"name": prev_lu["names"].get(i), "pos": prev_lu["pos"].get(i)}
                     for i in prev_nine if i not in nine],
        })
    except Exception:
        pass  # a lineup hiccup must never take the whole matchup panel down
    return out


_names: dict[int, str] = {}


async def _person_name(pid: int) -> str | None:
    if pid in _names:
        return _names[pid]
    try:
        r = await client._http().get(f"{client.BASE}/v1/people/{pid}",
                                     params={"fields": "people,id,fullName"})
        r.raise_for_status()
        people = r.json().get("people", [])
        if people:
            _names[pid] = people[0].get("fullName")
            return _names[pid]
    except Exception:
        pass
    return None


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
    away_id = g["teams"]["away"]["team"]["id"]
    home_id = g["teams"]["home"]["team"]["id"]
    (away_form, home_form,
     away["lineup"], home["lineup"]) = await asyncio.gather(
        _team_form(away_id), _team_form(home_id),
        _lineup_diff(away_id, game_pk, "away"),
        _lineup_diff(home_id, game_pk, "home"))
    away["lastSeries"], away["lastTenSeq"] = away_form["series"], away_form["lastTen"]
    home["lastSeries"], home["lastTenSeq"] = home_form["series"], home_form["lastTen"]
    return {
        "away": away,
        "home": home,
        "series": await _season_series(
            g["teams"]["away"]["team"]["id"], g["teams"]["home"]["team"]["id"],
            away["name"], home["name"]),
        "venue": (g.get("venue") or {}).get("name"),
    }
