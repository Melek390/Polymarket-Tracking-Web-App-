"""Pre-match prices for a soccer row — the '60c or more' side of the spec.

The screener cache refreshes every 15 minutes, so by the 60th minute its
prices are LIVE prices; using them would test the wrong thing (a 0-0 at 60'
has already crushed the favorite's price). The genuinely pre-match number
comes from the CLOB price history: the last 1-minute bar at or before
kickoff, fetched once per match and cached for the day.
"""

import json
import logging
import time
from datetime import datetime, timezone

import httpx

from backend.config.settings import settings
from backend.polymarket import clob

log = logging.getLogger(__name__)

_cache: dict[str, tuple[float, dict]] = {}   # slug -> (monotonic, prices)
_TTL = 6 * 3600.0


def _ts(iso: str) -> int:
    return int(datetime.fromisoformat(iso.replace("Z", "+00:00"))
               .astimezone(timezone.utc).timestamp())


async def _bar_at(token_id: str, at_ts: int) -> float | None:
    """Last 1-min bar at/before `at_ts` (cents), from a 45-min lookback."""
    try:
        r = await clob._http().get(
            f"{settings.clob_base_url}/prices-history",
            params={"market": token_id, "fidelity": 1,
                    "startTs": at_ts - 45 * 60, "endTs": at_ts + 120})
        r.raise_for_status()
        bars = [(p["t"], float(p["p"])) for p in r.json().get("history", [])]
    except (httpx.HTTPError, ValueError, KeyError):
        return None
    before = [b for b in bars if b[0] <= at_ts + 120]
    return round(before[-1][1] * 100, 2) if before else None


async def prices(row: dict) -> dict:
    """{'home': cents|None, 'away': cents|None} at kickoff for a screener
    soccer row (token_ids holds the [home, draw, away] Yes tokens)."""
    slug = row.get("event_slug") or ""
    now = time.monotonic()
    hit = _cache.get(slug)
    if hit and now - hit[0] < _TTL:
        return hit[1]
    out = {"home": None, "away": None}
    kickoff = row.get("kickoff")
    try:
        tokens = json.loads(row.get("token_ids") or "[]")
    except json.JSONDecodeError:
        tokens = []
    if kickoff and len(tokens) == 3:
        at = _ts(kickoff)
        for side, tok in (("home", tokens[0]), ("away", tokens[2])):
            if tok:
                out[side] = await _bar_at(tok, at)
    # cache even a miss (short of retrying forever) — but much shorter, so a
    # late-appearing history still gets picked up during the match
    ttl_key = now if (out["home"] is not None or out["away"] is not None) \
        else now - _TTL + 600
    _cache[slug] = (ttl_key, out)
    return out
