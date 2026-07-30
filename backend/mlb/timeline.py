"""Play-by-play timeline for a game: each play with its start/end time so the
price chart can show what inning it was — and who was pitching/batting — under
the cursor. Timestamps are epoch ms, matching the chart's tick timestamps."""

import re
from datetime import datetime

from backend.mlb import client


def _ms(iso: str | None) -> int | None:
    if not iso:
        return None
    try:
        return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000)
    except (ValueError, TypeError):
        return None


async def resolve_game_pk(slug: str) -> int | None:
    """Derive a gamePk from a Polymarket MLB slug like
    'mlb-cle-tb-2026-07-25' — the two team abbreviations + the date, matched
    against that day's schedule. (History games are usually gone from the
    screener cache, so we resolve from the slug.)"""
    s = slug.replace("-more-markets", "")
    m = re.search(r"\d{4}-\d{2}-\d{2}$", s)
    if not m:
        return None
    date = m.group(0)
    parts = s[: m.start()].rstrip("-").split("-")
    if len(parts) < 3 or parts[0] != "mlb":
        return None
    a1, a2 = parts[-2].lower(), parts[-1].lower()
    abbr = await client.team_abbreviations()  # full name -> abbr
    for g in await client.schedule(date):
        aw = (abbr.get(g["away"]) or "").lower()
        hm = (abbr.get(g["home"]) or "").lower()
        if {aw, hm} == {a1, a2}:
            return g["game_pk"]
    return None


async def play_timeline(game_pk: int) -> list[dict]:
    r = await client._http().get(f"{client.BASE}/v1/game/{game_pk}/playByPlay")
    r.raise_for_status()
    out = []
    for p in r.json().get("allPlays", []):
        a = p.get("about", {})
        mm = p.get("matchup", {})
        start = _ms(a.get("startTime"))
        if start is None:
            continue
        out.append({
            "start": start,
            "end": _ms(a.get("endTime")) or start,
            "inning": a.get("inning"),
            "half": a.get("halfInning"),  # top | bottom
            "pitcher": (mm.get("pitcher") or {}).get("fullName"),
            "batter": (mm.get("batter") or {}).get("fullName"),
        })
    return out
