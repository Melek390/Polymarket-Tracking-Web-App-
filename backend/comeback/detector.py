"""The Comeback Setup detector.

THE IDEA (client's spec, Aug 13): late in a game, home team down one run or
tied, the leading away side brings in a NEW pitcher — and that pitcher is
tired (worked yesterday, bad recent WHIP, or a heavy previous outing). That
is the moment the home team's true chances jump before the market has fully
repriced, so it must be spotted in seconds and flagged loudly, once.

HOW IT WATCHES, and why not GUMBO: the spec names /feed/live, but that is the
one endpoint this app never calls — it is 634 KB per poll and flooded the
worker twice (V2 house rule). The same fact arrives faster from the 3 KB
linescore this app already polls every 3 s: its `defense.pitcher` names the
incoming reliever DURING the inning break, while the boxscore-based
relievers-used counter lags ~2 minutes behind the announcement. This detector
therefore just reads the existing in-process cache — zero extra upstream
load — and tracks the defensive pitcher ID per side between ticks.

Firing during the Middle-of-inning break is deliberate: changes are announced
in the break before the bottom formally starts, and waiting for the half to
flip would give away the best of the window.
"""

import json
import logging
from datetime import datetime, timezone

from backend.comeback import pitchers, store
from backend.database.db import get_db
from backend.mlb import live as mlb_live
from backend.screener import live_prices

log = logging.getLogger(__name__)

# (game_pk, side) -> last seen defensive pitcher id. In-process is fine here:
# after a restart the first tick re-baselines silently (no event on the first
# sighting), so a restart can never fire a trigger for a pitcher who has been
# in for innings. One uvicorn worker = this dict is the whole picture.
_seen: dict[tuple[int, str], int] = {}


def _score_ok(st: dict, cfg: dict) -> bool:
    away, home = st["away"].get("runs"), st["home"].get("runs")
    if away is None or home is None:
        return False
    diff = away - home
    return diff == 1 or (cfg["allow_tied"] and diff == 0)


def _half_ok(st: dict, cfg: dict) -> bool:
    if not cfg["require_bottom"]:
        return True
    # `batting` comes from MLB's own offense/defense teams, which flip to the
    # next half DURING the break — so "home" here covers both the bottom half
    # under way and the Middle break right before it. Exactly the window the
    # client wants ("after top 8th is finished and bottom 8 starts").
    return st.get("batting") == "home"


def _prices_for(game_pk: int, mlb_home_name: str) -> dict:
    """Polymarket prices at trigger time, oriented to the MLB home/away teams.
    Live CLOB midpoint when the game is being watched, else the screener row.
    The screener lists MLB games away-first, so sides are matched by NAME."""
    with get_db() as conn:
        row = conn.execute(
            """SELECT event_slug, home_team, away_team, home_price, away_price
               FROM screener_cache WHERE sport='baseball' AND game_pk=?""",
            (game_pk,)).fetchone()
    if not row:
        return {"slug": None, "home_cents": None, "away_cents": None, "source": None}
    fresh = live_prices.cached(row["event_slug"]) or {}
    row_home = fresh.get("home") if fresh.get("home") is not None else row["home_price"]
    row_away = fresh.get("away") if fresh.get("away") is not None else row["away_price"]
    aligned = row["home_team"] == mlb_home_name
    return {"slug": row["event_slug"],
            "home_cents": row_home if aligned else row_away,
            "away_cents": row_away if aligned else row_home,
            "source": "live" if fresh else "cache"}


async def run() -> None:
    """One pass over the cached live states — called on a timer. Reads cost
    nothing upstream; a gameLog fetch happens only on an actual change."""
    cfg = store.config()
    for pk, st in mlb_live.live_states():
        if st.get("status") != "Live":
            continue
        batting = st.get("batting")
        defense = "home" if batting == "away" else "away"
        pid = (st.get("pitcher") or {}).get("id")
        if not pid:
            continue

        key = (pk, defense)
        prev = _seen.get(key)
        _seen[key] = pid
        if prev is None or prev == pid:
            continue  # first sighting (baseline) or no change

        # ---- a NEW pitcher just entered for `defense` ----
        pname = (st.get("pitcher") or {}).get("name")
        log.info("comeback: pitching change %s side=%s %s -> %s (%s)",
                 pk, defense, prev, pid, pname)
        if not cfg["enabled"] or defense != "away":
            continue  # only the leading-away-team scenario is the setup
        if not _score_ok(st, cfg):
            continue
        if (st.get("inning") or 0) < int(cfg["min_inning"]):
            continue
        if not _half_ok(st, cfg):
            continue

        rows = await pitchers.game_log(pid)
        if rows is None:
            # can't verify the fatigue filters -> no trigger. Firing unverified
            # is how false positives happen, and the quality gate is the part
            # of the spec that exists to prevent exactly that.
            log.warning("comeback: %s change to %s met the situation but the "
                        "gameLog was unreachable — NOT fired", pk, pid)
            continue
        quality = pitchers.evaluate(rows, cfg)
        if not quality["ok"]:
            log.info("comeback: %s %s fails quality (%d match(es): %s)",
                     pk, pname, quality["matches"], quality["reasons"] or "none")
            continue

        prices = _prices_for(pk, st["home"]["name"])
        payload = {
            "slug": prices["slug"],
            "away_name": st["away"]["name"], "home_name": st["home"]["name"],
            "away_abbr": st["away"].get("abbr"), "home_abbr": st["home"].get("abbr"),
            "away_runs": st["away"].get("runs"), "home_runs": st["home"].get("runs"),
            "inning": st.get("inning"), "inning_state": st.get("inning_state"),
            "pitcher_name": pname,
            "quality": quality,
            "home_price_cents": prices["home_cents"],
            "away_price_cents": prices["away_cents"],
            "price_source": prices["source"],
            "config_at_trigger": cfg,
            "detected_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        if store.insert_trigger(pk, pid, payload):
            log.info("comeback: TRIGGER %s %s@%s %s-%s inning %s — %s in for %s: %s | home %sc",
                     pk, payload["away_abbr"], payload["home_abbr"],
                     payload["away_runs"], payload["home_runs"], payload["inning"],
                     pname, payload["away_name"], "; ".join(quality["reasons"]),
                     payload["home_price_cents"])
