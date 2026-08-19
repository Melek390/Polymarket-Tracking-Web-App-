"""Play-by-play timeline for a game: each play with its start/end time so the
price chart can show what inning it was — and who was pitching/batting — under
the cursor. Timestamps are epoch ms, matching the chart's tick timestamps."""

import re
from datetime import datetime

from backend.database import db
from backend.mlb import client


def _ms(iso: str | None) -> int | None:
    if not iso:
        return None
    try:
        return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000)
    except (ValueError, TypeError):
        return None


# Polymarket slugs keep some older/looser abbreviations than the MLB API uses
# (the Athletics are "oak" in slugs but "ATH" to MLB; Arizona is "ari" vs "AZ"),
# so match on any of a team's accepted forms rather than one exact string.
_ABBR_ALIASES = {
    "ATH": {"oak", "ath", "oakland"},
    "AZ": {"ari", "az", "arz"},
    "CWS": {"cws", "chw"},
    "WSH": {"wsh", "was"},
    "SD": {"sd", "sdp"},
    "SF": {"sf", "sfg"},
    "TB": {"tb", "tbr"},
    "KC": {"kc", "kcr"},
}


def _forms(abbr: str, name: str) -> set[str]:
    a = (abbr or "").lower()
    forms = {a} | _ABBR_ALIASES.get((abbr or "").upper(), set())
    forms.add((name or "").split()[-1].lower())  # "Athletics" -> "athletics"
    return {f for f in forms if f}


async def resolve_game_pk(slug: str, sched_memo: dict | None = None) -> int | None:
    """The gamePk for a Polymarket MLB slug like 'mlb-cle-tb-2026-07-25'.

    Prefers the match the screener already made (it compares full team names,
    which agree with MLB exactly); falls back to reading the two abbreviations
    and the date out of the slug for games the cache has since dropped.

    sched_memo lets a caller resolving MANY slugs share one schedule fetch per
    date — a page of positions is usually a handful of dates. It is never
    cached globally: mlb/live.py reads status off the same endpoint and must
    keep seeing fresh data."""
    s = slug.replace("-more-markets", "")

    cached = db.screener_game_pk(s)
    if cached:
        return cached

    m = re.search(r"\d{4}-\d{2}-\d{2}$", s)
    if not m:
        return None
    date = m.group(0)
    parts = s[: m.start()].rstrip("-").split("-")
    if len(parts) < 3 or parts[0] != "mlb":
        return None
    a1, a2 = parts[-2].lower(), parts[-1].lower()
    abbr = await client.team_abbreviations()  # full name -> abbr
    games = sched_memo.get(date) if sched_memo is not None else None
    if games is None:
        games = await client.schedule(date)
        if sched_memo is not None:
            sched_memo[date] = games
    for g in games:
        away = _forms(abbr.get(g["away"]), g["away"])
        home = _forms(abbr.get(g["home"]), g["home"])
        if (a1 in away and a2 in home) or (a1 in home and a2 in away):
            return g["game_pk"]
    return None


async def _pitcher_eras(game_pk: int) -> tuple[dict[int, str], str, str]:
    """{pitcher id: season ERA} plus the away/home abbreviations, from the
    boxscore. One extra call, made once when a history page opens."""
    try:
        r = await client._http().get(f"{client.BASE}/v1/game/{game_pk}/boxscore")
        r.raise_for_status()
        box = r.json()["teams"]
    except Exception:
        return {}, "AWY", "HOM"
    eras: dict[int, str] = {}
    for side in ("away", "home"):
        for pid in box[side].get("pitchers", []):
            pl = box[side]["players"].get(f"ID{pid}", {})
            era = pl.get("seasonStats", {}).get("pitching", {}).get("era")
            if era is not None:
                eras[pid] = era
    away = box["away"].get("team", {}).get("abbreviation") or "AWY"
    home = box["home"].get("team", {}).get("abbreviation") or "HOM"
    return eras, away, home


async def play_timeline(game_pk: int) -> dict:
    r = await client._http().get(f"{client.BASE}/v1/game/{game_pk}/playByPlay")
    r.raise_for_status()
    eras, away_abbr, home_abbr = await _pitcher_eras(game_pk)
    out = []
    for p in r.json().get("allPlays", []):
        a = p.get("about", {})
        mm = p.get("matchup", {})
        res = p.get("result", {})
        start = _ms(a.get("startTime"))
        # skip administrative "Game Advisory" notes — they aren't plays, so
        # they must not label a price move or an inning band
        if start is None or res.get("eventType") == "game_advisory":
            continue
        pit = mm.get("pitcher") or {}
        out.append({
            "start": start,
            "end": _ms(a.get("endTime")) or start,
            "inning": a.get("inning"),
            "half": a.get("halfInning"),  # top | bottom
            "pitcher": pit.get("fullName"),
            "era": eras.get(pit.get("id")),
            "batter": (mm.get("batter") or {}).get("fullName"),
            # what happened, so a price move can name its cause
            "event": res.get("event"),
            "desc": res.get("description"),
            "rbi": res.get("rbi") or 0,
            "scoring": bool(a.get("isScoringPlay")),
            # score AFTER this play — i.e. the score as of that moment
            "awayScore": res.get("awayScore"),
            "homeScore": res.get("homeScore"),
        })
    return {"away": away_abbr, "home": home_abbr, "plays": out}
