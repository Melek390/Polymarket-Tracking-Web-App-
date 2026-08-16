"""Matching our Polymarket soccer rows to API-FOOTBALL fixtures.

Two naming worlds: Polymarket titles say "Man City", "PSG", "Inter Milan";
API-FOOTBALL says "Manchester City", "Paris Saint Germain", "Inter". The
matcher normalizes both and accepts a match when BOTH teams agree (either
direction of containment, with an alias table for the stubborn cases) and
kickoff is within a couple of hours. Team pairs are unique per matchday in
a league, so this is far less fragile than it sounds — and a miss only
means "no live strip on that row", never a wrong alert (the alert requires
a confirmed match).
"""

import re
import unicodedata

# Polymarket league labels -> whether they are one of the client's big five.
# EXACT match on the normalized label, never substring: the live sweep found
# "Brazil Serie A", "Premier League (Kazakhstan)" and "Russian Premier
# League" all masquerading — a country qualifier means it is NOT the big-5
# league, so any unlisted variant stays out until added here deliberately.
_BIG5_LABELS = {
    "premier league": "Premier League",
    "english premier league": "Premier League",
    "epl": "Premier League",
    "bundesliga": "Bundesliga",
    "german bundesliga": "Bundesliga",
    "la liga": "La Liga",
    "laliga": "La Liga",
    "spanish la liga": "La Liga",
    "serie a": "Serie A",
    "italian serie a": "Serie A",
    "ligue 1": "Ligue 1",
    "french ligue 1": "Ligue 1",
    "ligue 1 mcdonalds": "Ligue 1",     # sponsor-era naming
}

# name aliases that containment alone cannot bridge, normalized-form on both
# sides — extend as real mismatches show up in the logs
_ALIASES = {
    "psg": "paris saint germain",
    "bayern munich": "bayern munchen",
    "inter milan": "inter",
    "man city": "manchester city",
    "man united": "manchester united",
    "man utd": "manchester united",
    "spurs": "tottenham",
    "wolves": "wolverhampton",
    "leverkusen": "bayer leverkusen",
    "gladbach": "borussia monchengladbach",
    "atletico": "atletico madrid",
    "athletic": "athletic club",
    "betis": "real betis",
    "napoli": "ssc napoli",
    "marseille": "olympique marseille",
    "lyon": "olympique lyonnais",
    "saint etienne": "saint-etienne",
}

_NOISE = re.compile(
    r"\b(fc|cf|afc|ac|as|ss|ssc|sc|sv|vfb|vfl|tsg|rc|rcd|cd|og|1899|fsv|"
    r"borussia|real|club|de|calcio|stade)\b")


def big5_league(label: str | None) -> str | None:
    """Canonical big-5 league name for a Polymarket league label, or None."""
    low = re.sub(r"[^a-z0-9 ]+", "", (label or "").lower())
    low = re.sub(r"\s+", " ", low).strip()
    return _BIG5_LABELS.get(low)


def norm(name: str | None) -> str:
    """Accent-folded, lowercased, club-word noise removed."""
    if not name:
        return ""
    s = unicodedata.normalize("NFKD", name)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = _NOISE.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return _ALIASES.get(s, s)


def same_team(a: str | None, b: str | None) -> bool:
    na, nb = norm(a), norm(b)
    if not na or not nb:
        return False
    return na == nb or na in nb or nb in na


def fixture_for_row(row: dict, fixtures: list[dict]) -> dict | None:
    """The live fixture whose two teams both match the screener row's.

    With the worldwide live feed, name doubles exist (Liverpool FC vs
    Liverpool Montevideo) — requiring BOTH teams already kills nearly all of
    them, and a kickoff-proximity check (4h) removes the rest."""
    row_ko = _ts(row.get("kickoff"))
    for f in fixtures:
        if not (same_team(row.get("home_team"), f.get("home"))
                and same_team(row.get("away_team"), f.get("away"))):
            continue
        fko = _ts(f.get("kickoff"))
        if row_ko and fko and abs(row_ko - fko) > 4 * 3600:
            continue
        return f
    return None


def _ts(iso: str | None) -> int | None:
    if not iso:
        return None
    try:
        from datetime import datetime
        return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp())
    except ValueError:
        return None
