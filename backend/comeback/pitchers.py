"""Pitcher fatigue checks for the Comeback Setup trigger.

One gameLog fetch per pitcher per few hours (cached), evaluated against the
three tiredness signals in the client's spec:

  1. pitched yesterday (consecutive days of work)
  2. recent WHIP over the last N appearances above the threshold
  3. high pitch count in the previous outing

The fetch happens ONLY when a pitching change is actually being evaluated —
a handful of times a night — so the volume is negligible. Still retried once
with a short backoff per the spec; on total failure the caller decides
(the detector skips the trigger and logs, rather than firing unverified).
"""

import asyncio
import logging
import time
from datetime import date, timedelta

from backend.mlb import client

log = logging.getLogger(__name__)

_cache: dict[int, tuple[float, list[dict]]] = {}   # pid -> (fetched_at, rows)
CACHE_TTL = 3 * 3600
# a reliever's gameLog is small; the fields= trick keeps it tiny (house rule)
_FIELDS = ("stats,splits,date,stat,inningsPitched,hits,baseOnBalls,"
           "numberOfPitches,gamesPlayed")


def _ip_outs(ip_text) -> int:
    """'1.2' innings -> 5 outs (MLB writes thirds after the dot)."""
    try:
        text = str(ip_text or "0")
        whole, _, frac = text.partition(".")
        return int(whole or 0) * 3 + int(frac or 0)
    except ValueError:
        return 0


async def game_log(pid: int) -> list[dict] | None:
    """This season's outings, oldest first: [{date, ip_outs, hits, walks,
    pitches}]. None = MLB unreachable after a retry."""
    now = time.monotonic()
    hit = _cache.get(pid)
    if hit and now - hit[0] < CACHE_TTL:
        return hit[1]
    for attempt in (1, 2):
        try:
            r = await client._http().get(
                f"{client.BASE}/v1/people/{pid}/stats",
                params={"stats": "gameLog", "group": "pitching",
                        "season": date.today().year, "fields": _FIELDS})
            r.raise_for_status()
            splits = (r.json().get("stats") or [{}])[0].get("splits", [])
            rows = []
            for s in splits:
                st = s.get("stat", {})
                rows.append({
                    "date": s.get("date"),
                    "ip_outs": _ip_outs(st.get("inningsPitched")),
                    "hits": st.get("hits") or 0,
                    "walks": st.get("baseOnBalls") or 0,
                    "pitches": st.get("numberOfPitches") or 0,
                })
            rows.sort(key=lambda x: x["date"] or "")
            _cache[pid] = (now, rows)
            return rows
        except Exception as e:
            if attempt == 1:
                await asyncio.sleep(1.0)
            else:
                log.warning("comeback: gameLog %s failed twice: %s", pid, e)
    return None


def evaluate(rows: list[dict], cfg: dict, today: date | None = None) -> dict:
    """The three checks against a fetched log. `rows` are this season's
    outings BEFORE the current game (today's row, if MLB already wrote one,
    is excluded — the current appearance is not 'previous work')."""
    today = today or date.today()
    prior = [r for r in rows if r["date"] and r["date"] < today.isoformat()]

    yesterday = (today - timedelta(days=1)).isoformat()
    consecutive = bool(prior) and prior[-1]["date"] == yesterday

    window = prior[-int(cfg["whip_apps"]):]
    outs = sum(r["ip_outs"] for r in window)
    whip = ((sum(r["hits"] for r in window) + sum(r["walks"] for r in window))
            / (outs / 3)) if outs else None
    whip_high = whip is not None and whip > float(cfg["whip_threshold"])

    prev_pitches = prior[-1]["pitches"] if prior else 0
    worked = prev_pitches >= int(cfg["prev_pitches"])

    reasons = []
    if consecutive:
        reasons.append("pitched yesterday (consecutive days)")
    if whip_high:
        reasons.append(f"recent WHIP {whip:.2f} over last {len(window)} apps "
                       f"(> {cfg['whip_threshold']})")
    if worked:
        reasons.append(f"{prev_pitches} pitches in previous outing "
                       f"(>= {cfg['prev_pitches']})")

    matches = len(reasons)
    ok = matches >= int(cfg["quality_min"])
    if cfg["require_consecutive_days"] and not consecutive:
        ok = False
    return {"ok": ok, "matches": matches, "reasons": reasons,
            "consecutive_days": consecutive,
            "recent_whip": round(whip, 3) if whip is not None else None,
            "whip_window": len(window),
            "prev_outing_pitches": prev_pitches,
            "last_outing_date": prior[-1]["date"] if prior else None}
