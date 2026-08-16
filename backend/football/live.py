"""The soccer live job: one pass = refresh the big-5 live cache, run the
0-0 detector, record outcomes. Browsers only ever read the cache (house
rule: no browser request fans out upstream).

REQUEST BUDGET — the whole design bends around API-FOOTBALL quotas:
  - zero requests while no big-5 match is inside its live window (the gate
    reads our own screener cache, which knows every kickoff)
  - one /fixtures?live=… request per pass while matches are on
  - one /fixtures/statistics per live fixture per stats interval (possession
    / shots / reds change slowly; 120s is plenty)
  - one /fixtures?id= per finished trigger, once, for the final score
"""

import json
import logging
import time
from datetime import datetime, timedelta, timezone

from backend.database.db import get_db
from backend.football import client, detector, matcher, prematch, store

log = logging.getLogger(__name__)

# a soccer match with stoppage time fits comfortably in 150 minutes
_LIVE_WINDOW_BEFORE_MIN = 10
_LIVE_WINDOW_AFTER_MIN = 150

_fixtures: dict[int, dict] = {}          # fixture_id -> live fixture row
_stats: dict[int, tuple[float, dict]] = {}   # fixture_id -> (monotonic, stats)
_slug_of: dict[int, str] = {}            # fixture_id -> screener event_slug
_last_seen: dict[int, float] = {}        # fixture_id -> last time in live feed
_updated_at: str | None = None


def _big5_rows() -> list[dict]:
    """Screener soccer rows in one of the five leagues, kickoff inside the
    live window — the gate that keeps quiet days at zero requests."""
    now = datetime.now(timezone.utc)
    lo = (now - timedelta(minutes=_LIVE_WINDOW_AFTER_MIN)).strftime("%Y-%m-%dT%H:%M:%SZ")
    hi = (now + timedelta(minutes=_LIVE_WINDOW_BEFORE_MIN)).strftime("%Y-%m-%dT%H:%M:%SZ")
    with get_db() as conn:
        rows = [dict(r) for r in conn.execute(
            """SELECT event_slug, league, home_team, away_team, kickoff,
                      home_price, draw_price, away_price, token_ids
               FROM screener_cache
               WHERE sport='soccer' AND kickoff BETWEEN ? AND ?""", (lo, hi))]
    return [r for r in rows if matcher.big5_league(r.get("league"))]


async def run(stats_interval_s: float = 120.0) -> None:
    """One pass — called on a timer from the scheduler."""
    global _updated_at
    rows = _big5_rows()
    if not rows:
        if _fixtures:
            _fixtures.clear()
            _stats.clear()
            _slug_of.clear()
            _last_seen.clear()
        return

    fixtures = await client.live_fixtures()
    now_mono = time.monotonic()
    live_ids = set()
    for f in fixtures:
        fid = f["fixture_id"]
        live_ids.add(fid)
        _fixtures[fid] = f
        _last_seen[fid] = now_mono
    # matches that left the live feed keep their last state briefly (so the
    # UI can show the final and the outcome pass can settle), then age out
    for fid in [k for k in _fixtures if k not in live_ids]:
        if _fixtures[fid].get("status") not in ("FT", "AET", "PEN"):
            _fixtures[fid]["status"] = "FT?"
        if now_mono - _last_seen.get(fid, now_mono) > 1800:
            _fixtures.pop(fid, None)
            _stats.pop(fid, None)
            _slug_of.pop(fid, None)
            _last_seen.pop(fid, None)

    cfg = store.config()
    for row in rows:
        f = matcher.fixture_for_row(row, list(_fixtures.values()))
        if not f:
            continue
        fid = f["fixture_id"]
        _slug_of[fid] = row["event_slug"]

        # stats on their own slower cadence
        had = _stats.get(fid)
        if fid in live_ids and (not had or now_mono - had[0] >= stats_interval_s):
            got = await client.fixture_statistics(fid)
            if got:
                _stats[fid] = (now_mono, got)

        # the alert
        pre = await prematch.prices(row)
        payload = detector.check(f, row, pre,
                                 (_stats.get(fid) or (0, None))[1], cfg)
        if payload and store.insert_trigger(fid, payload):
            log.info("football: TRIGGER %s — %s vs %s 0-0 at %s' "
                     "(favorite %s pre-match %sc, reds %s)",
                     payload["league"], payload["home_name"],
                     payload["away_name"], payload["minute"],
                     payload["favorite_name"],
                     payload[f"prematch_{payload['favorite']}_cents"],
                     payload["favorite_red_cards"])

    # outcomes: one cheap call per finished trigger, once
    for t in store.pending_outcomes():
        fid = t["fixture_id"]
        f = _fixtures.get(fid)
        if f and f.get("status") in ("1H", "HT", "2H", "ET", "P"):
            continue                     # still playing
        final = await client.fixture_final(fid)
        if final and final.get("status") in ("FT", "AET", "PEN"):
            store.save_outcome(t["id"], {
                "final": f"{final['home_goals']}-{final['away_goals']}",
                "home_goals": final["home_goals"],
                "away_goals": final["away_goals"],
                "favorite_scored": bool(
                    (final.get("home_goals") if t.get("favorite") == "home"
                     else final.get("away_goals")) or 0),
                "recorded_at": datetime.now(timezone.utc)
                    .strftime("%Y-%m-%dT%H:%M:%SZ"),
            })

    _updated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def snapshot() -> dict:
    """What the browser reads: every cached big-5 live fixture with its
    stats, keyed by screener slug where a match was made."""
    out = []
    for fid, f in _fixtures.items():
        stats = (_stats.get(fid) or (0, None))[1]
        out.append({**f, "slug": _slug_of.get(fid), "stats": stats})
    return {"fixtures": out, "updated_at": _updated_at,
            "key_configured": client.has_key()}
