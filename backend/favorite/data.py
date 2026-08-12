"""Shared data layer for the Clear Favorite scorer (client spec, Aug 11).

Every pull is cached at module level so scoring a full slate costs a handful
of upstream calls, not hundreds. League-wide tables (pitchers, hitters)
refresh daily; game-day data (standings, schedules, weather) every 10-60 min.
Reuses the shared httpx client from backend.mlb.client — one client per
process is the house rule (July 27 lesson)."""

import time
from datetime import datetime, timedelta, timezone

from backend.mlb import client

_cache: dict = {}


def _get(key, ttl):
    hit = _cache.get(key)
    if hit and (ttl is None or time.monotonic() - hit[0] < ttl):
        return hit[1]
    return None


def _put(key, val):
    _cache[key] = (time.monotonic(), val)
    return val


def _ip(text) -> float:
    """MLB innings-pitched strings are thirds: '123.1' = 123 1/3 innings."""
    try:
        whole, _, frac = str(text).partition(".")
        return int(whole or 0) + int(frac or 0) / 3
    except ValueError:
        return 0.0


def _zstats(values: list[float]) -> tuple[float, float]:
    n = len(values)
    if n < 2:
        return 0.0, 1.0
    mean = sum(values) / n
    var = sum((v - mean) ** 2 for v in values) / n
    return mean, (var ** 0.5) or 1.0


async def league_pitching() -> dict:
    """One daily league-wide pitching pull feeding TWO factors:
    - "starters": {player_id: {...,"rating","regular_starter"}} — z-composite
      of ERA/WHIP/K9, re-standardised so the rating IS in league standard
      deviations. Rated pool = 30+ IP; the DISTRIBUTION behind those SD units
      is regular starters only (5+ GS, 30+ IP). See the table comment below.
    - "pen_rank": {team_id: 1..30} — bullpen composite rank from relievers.
    """
    if (hit := _get("pitching", 6 * 3600)) is not None:
        return hit
    r = await client._http().get(
        f"{client.BASE}/v1/stats",
        params={"stats": "season", "group": "pitching", "sportId": 1,
                "season": datetime.now().year, "playerPool": "ALL", "limit": 3000})
    r.raise_for_status()
    rows = []
    for s in (r.json().get("stats") or [{}])[0].get("splits", []):
        st = s.get("stat", {})
        ip = _ip(st.get("inningsPitched"))
        if ip < 10:
            continue
        try:
            rows.append({
                "id": s.get("player", {}).get("id"),
                "name": s.get("player", {}).get("fullName"),
                "team_id": (s.get("team") or {}).get("id"),
                "era": float(st.get("era")), "whip": float(st.get("whip")),
                "k9": (st.get("strikeOuts") or 0) * 9 / ip, "ip": ip,
                "gs": st.get("gamesStarted") or 0, "g": st.get("gamesPlayed") or 0,
            })
        except (TypeError, ValueError):
            continue

    # The DISTRIBUTION is regular starters only, so a rating keeps meaning
    # "standard deviations among starting pitchers".
    starters = [p for p in rows if p["gs"] >= 5 and p["ip"] >= 30]
    e_m, e_s = _zstats([p["era"] for p in starters])
    w_m, w_s = _zstats([p["whip"] for p in starters])
    k_m, k_s = _zstats([p["k9"] for p in starters])

    def _raw(p):
        return ((e_m - p["era"]) / e_s + (w_m - p["whip"]) / w_s
                + (p["k9"] - k_m) / k_s) / 3

    for p in starters:
        p["raw"] = _raw(p)
    r_m, r_s = _zstats([p["raw"] for p in starters])

    # The LOOKUP TABLE is deliberately wider than the distribution. Requiring
    # gs>=5 to have a rating at all called swingmen emergency call-ups: Drew
    # Anderson (Aug 12) had 71 IP over 42 appearances and a 3.91 ERA but only
    # 4 starts, so the sp factor scored 0/18 for BOTH sides of DET-CLE — the
    # gap needs two ratings. Anyone with a real workload is now rated on the
    # starters' scale; a genuine call-up (<30 IP, e.g. George Klassen at 8.7)
    # still has no line and still trips the emergency-starter hard rule.
    # A pitcher is only ever looked up once MLB announces him as today's
    # starter, so carrying relievers here costs nothing.
    table = {}
    for p in (q for q in rows if q["ip"] >= 30):
        p["raw"] = _raw(p)
        p["rating"] = (p["raw"] - r_m) / r_s  # true SD units across the league
        p["regular_starter"] = p["gs"] >= 5   # False = rated, but a swingman
        table[p["id"]] = p

    # bullpen: relievers aggregated per team, IP-weighted, ranked 1..30
    pens: dict[int, dict] = {}
    for p in rows:
        if p["gs"] * 2 > p["g"] or not p["team_id"]:
            continue  # mostly a starter
        pen = pens.setdefault(p["team_id"], {"ip": 0.0, "era": 0.0, "whip": 0.0})
        pen["ip"] += p["ip"]
        pen["era"] += p["era"] * p["ip"]
        pen["whip"] += p["whip"] * p["ip"]
    scored = []
    for tid, pen in pens.items():
        if pen["ip"] > 0:
            scored.append((tid, pen["era"] / pen["ip"] + 2 * (pen["whip"] / pen["ip"])))
    scored.sort(key=lambda x: x[1])  # lower is better
    pen_rank = {tid: i + 1 for i, (tid, _) in enumerate(scored)}
    return _put("pitching", {"starters": table, "pen_rank": pen_rank})


async def team_top_hitters(team_id: int, n: int = 5) -> list[dict]:
    """The team's top-n regulars by season OPS (min 150 PA) — the "high
    impact players" whose absence factor 6 punishes."""
    if (hit := _get("hitting", 6 * 3600)) is None:
        r = await client._http().get(
            f"{client.BASE}/v1/stats",
            params={"stats": "season", "group": "hitting", "sportId": 1,
                    "season": datetime.now().year, "playerPool": "ALL", "limit": 3000})
        r.raise_for_status()
        by_team: dict[int, list] = {}
        for s in (r.json().get("stats") or [{}])[0].get("splits", []):
            st = s.get("stat", {})
            tid = (s.get("team") or {}).get("id")
            try:
                if tid and (st.get("plateAppearances") or 0) >= 150:
                    by_team.setdefault(tid, []).append({
                        "id": s.get("player", {}).get("id"),
                        "name": s.get("player", {}).get("fullName"),
                        "ops": float(st.get("ops")),
                        "pa": st.get("plateAppearances"),
                    })
            except (TypeError, ValueError):
                continue
        for lst in by_team.values():
            lst.sort(key=lambda p: -p["ops"])
        hit = _put("hitting", by_team)
    return (hit.get(team_id) or [])[:n]


async def standings() -> dict[int, dict]:
    """{team_id: {wins, losses, rs, ra}} for Pythagorean strength."""
    if (hit := _get("standings", 600)) is not None:
        return hit
    r = await client._http().get(
        f"{client.BASE}/v1/standings",
        params={"leagueId": "103,104", "season": datetime.now().year,
                "standingsTypes": "regularSeason"})
    r.raise_for_status()
    out = {}
    for rec in r.json().get("records", []):
        for t in rec.get("teamRecords", []):
            rs, rd = t.get("runsScored"), t.get("runDifferential")
            ra = t.get("runsAllowed")
            if ra is None and rs is not None and rd is not None:
                ra = rs - rd
            out[t["team"]["id"]] = {"wins": t.get("wins"), "losses": t.get("losses"),
                                    "rs": rs, "ra": ra}
    return _put("standings", out)


async def team_schedule(team_id: int) -> list[dict]:
    """The team's games over the last 3 weeks (finals with scores + today's),
    date-ordered: feeds rest/travel, recent form and pen workload."""
    key = ("sched", team_id)
    if (hit := _get(key, 3600)) is not None:
        return hit
    end = datetime.now()
    r = await client._http().get(
        f"{client.BASE}/v1/schedule",
        params={"sportId": 1, "teamId": team_id, "gameType": "R",
                "startDate": (end - timedelta(days=21)).date().isoformat(),
                "endDate": (end + timedelta(days=1)).date().isoformat()})
    r.raise_for_status()
    out = []
    for d in r.json().get("dates", []):
        for g in d.get("games", []):
            t = g["teams"]
            mine = "home" if t["home"]["team"]["id"] == team_id else "away"
            other = "away" if mine == "home" else "home"
            out.append({
                "pk": g["gamePk"], "date": d.get("date"),
                "final": g["status"]["abstractGameState"] == "Final",
                "home": mine == "home",
                "venue_id": (g.get("venue") or {}).get("id"),
                "won": bool(t[mine].get("isWinner")),
                "my_runs": t[mine].get("score"), "opp_runs": t[other].get("score"),
                "side": mine,
            })
    return _put(key, out)


async def pen_used_last3(team_id: int) -> int | None:
    """Relievers used across the team's finished games in the last 3 days —
    the workload half of factor 3. One tiny field-filtered boxscore per game,
    cached per gamePk forever (a finished game never changes)."""
    sched = await team_schedule(team_id)
    cutoff = (datetime.now() - timedelta(days=3)).date().isoformat()
    used = 0
    for g in sched:
        if not g["final"] or (g["date"] or "") < cutoff:
            continue
        key = ("penbox", g["pk"])
        box = _get(key, None)
        if box is None:
            r = await client._http().get(
                f"{client.BASE}/v1/game/{g['pk']}/boxscore",
                params={"fields": "teams,away,home,pitchers"})
            r.raise_for_status()
            box = _put(key, r.json())
        pitchers = box.get("teams", {}).get(g["side"], {}).get("pitchers", [])
        used += max(0, len(pitchers) - 1)  # minus the starter
    return used


async def game_info(game_pk: int) -> dict | None:
    """Team ids, venue, kickoff and probable starters for one game."""
    key = ("game", game_pk)
    if (hit := _get(key, 600)) is not None:
        return hit
    r = await client._http().get(
        f"{client.BASE}/v1/schedule",
        params={"gamePk": game_pk, "hydrate": "probablePitcher"})
    r.raise_for_status()
    games = [g for d in r.json().get("dates", []) for g in d.get("games", [])]
    if not games:
        return None
    g = games[0]
    return _put(key, {
        "away_id": g["teams"]["away"]["team"]["id"],
        "home_id": g["teams"]["home"]["team"]["id"],
        "away_name": g["teams"]["away"]["team"].get("name"),
        "home_name": g["teams"]["home"]["team"].get("name"),
        "venue_id": (g.get("venue") or {}).get("id"),
        "game_date": g.get("gameDate"),  # ISO UTC first pitch
        "probables": {s: (g["teams"][s].get("probablePitcher") or {}).get("id")
                      for s in ("away", "home")},
    })


# ---- park + weather -------------------------------------------------------
# Static table keyed by HOME team id: (lat, lon, park run factor ~100).
# Factors are Baseball Savant multi-year approximations — good enough for a
# 5-point factor; refresh by hand if a park changes character.
STADIUMS: dict[int, tuple[float, float, int]] = {
    108: (33.800, -117.883, 99),   # LAA
    109: (33.445, -112.067, 101),  # ARI
    110: (39.284, -76.622, 100),   # BAL
    111: (42.346, -71.097, 106),   # BOS
    112: (41.948, -87.655, 100),   # CHC
    113: (39.097, -84.507, 104),   # CIN
    114: (41.496, -81.685, 98),    # CLE
    115: (39.756, -104.994, 112),  # COL
    116: (42.339, -83.049, 98),    # DET
    117: (29.757, -95.356, 100),   # HOU
    118: (39.051, -94.480, 99),    # KC
    119: (34.074, -118.240, 98),   # LAD
    120: (38.873, -77.007, 100),   # WSH
    121: (40.757, -73.846, 97),    # NYM
    133: (38.580, -121.513, 101),  # ATH (Sacramento)
    134: (40.447, -80.006, 97),    # PIT
    135: (32.707, -117.157, 97),   # SD
    136: (47.591, -122.332, 95),   # SEA
    137: (37.778, -122.389, 96),   # SF
    138: (38.623, -90.193, 98),    # STL
    139: (27.980, -82.507, 98),    # TB (Steinbrenner Field)
    140: (32.747, -97.081, 102),   # TEX
    141: (43.641, -79.389, 101),   # TOR
    142: (44.982, -93.278, 100),   # MIN
    143: (39.906, -75.166, 102),   # PHI
    144: (33.891, -84.468, 101),   # ATL
    145: (41.830, -87.634, 101),   # CWS
    146: (25.778, -80.220, 97),    # MIA
    147: (40.829, -73.926, 100),   # NYY
    158: (43.028, -87.971, 101),   # MIL
}


async def weather(home_team_id: int, kickoff_iso: str | None) -> dict | None:
    """Forecast nearest first pitch at the home park (Open-Meteo, no key).
    {"temp_c", "wind_kmh", "precip_pct", "extreme"} or None off the map."""
    spot = STADIUMS.get(home_team_id)
    if not spot:
        return None
    key = ("wx", home_team_id)
    if (hit := _get(key, 3600)) is not None:
        return hit
    try:
        r = await client._http().get(
            "https://api.open-meteo.com/v1/forecast",
            params={"latitude": spot[0], "longitude": spot[1],
                    "hourly": "temperature_2m,precipitation_probability,wind_speed_10m",
                    "forecast_days": 2, "timezone": "UTC"})
        r.raise_for_status()
        h = r.json().get("hourly", {})
        times = h.get("time") or []
        if not times:
            return None
        want = (kickoff_iso or "")[:13]  # "2026-08-11T23"
        idx = next((i for i, t in enumerate(times) if t[:13] == want), 0)
        temp = (h.get("temperature_2m") or [None])[idx]
        wind = (h.get("wind_speed_10m") or [None])[idx]
        precip = (h.get("precipitation_probability") or [None])[idx]
        out = {"temp_c": temp, "wind_kmh": wind, "precip_pct": precip,
               "extreme": ((wind or 0) >= 32 or (precip or 0) >= 60
                           or (temp is not None and (temp <= 2 or temp >= 38)))}
        return _put(key, out)
    except Exception:
        return None


async def open_price(token_id: str, kickoff_iso: str | None) -> float | None:
    """Today's opening price (cents) for a CLOB token — the baseline for
    factor 1's line-movement bonus. Earliest pre-first-pitch point today."""
    if not token_id:
        return None
    key = ("open", token_id)
    if (hit := _get(key, 3600)) is not None:
        return hit
    try:
        r = await client._http().get(
            "https://clob.polymarket.com/prices-history",
            params={"market": token_id, "interval": "max", "fidelity": 10})
        r.raise_for_status()
        hist = r.json().get("history", []) or []
        day_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0)
        pts = [h for h in hist if h.get("t", 0) >= day_start.timestamp()]
        if not pts:
            pts = hist[-12:]  # thin market: fall back to the latest points
        if not pts:
            return None
        return _put(key, float(pts[0]["p"]) * 100)
    except Exception:
        return None
