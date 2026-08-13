"""Outcome recording for Comeback Setup triggers — "was it correct?" as data.

Each trigger's row grows an `outcome` object with two kinds of answer:

  samples   the MLB home team's Polymarket price 5 / 15 / 30 minutes after
            the trigger — did the market move the way the thesis says?
  final     the final score once the game ends, and whether the home team
            actually came back — was the thesis right, whatever the price did?

A one-minute job fills these in. Price samples come straight from the CLOB
midpoints endpoint (a couple of tokens per open trigger — negligible), NOT
from the browser-driven live-price cache, so outcomes land whether or not
anyone had the game on screen. A sample whose moment passed while the price
was unavailable is recorded as null and never chased — an honest gap beats a
number quietly taken at the wrong time.
"""

import logging
from datetime import datetime, timedelta, timezone

from backend.comeback import store
from backend.database.db import get_db
from backend.mlb import client as mlb_client
from backend.mlb import live as mlb_live
from backend.polymarket import clob

log = logging.getLogger(__name__)

SAMPLE_MINUTES = (5, 15, 30)
# how long past its due moment a sample may still be taken (the job runs every
# minute, so anything beyond a couple of cycles means the service was down —
# record null rather than a price from the wrong moment)
SAMPLE_SLACK_MIN = 3


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse(ts: str) -> datetime | None:
    try:
        return datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


async def _home_price(game_pk: int, mlb_home_name: str) -> float | None:
    """The MLB home team's current midpoint, in cents. Orientation by NAME —
    the screener lists MLB games away-first (standing gotcha)."""
    with get_db() as conn:
        row = conn.execute(
            """SELECT home_team, token_ids FROM screener_cache
               WHERE sport='baseball' AND game_pk=?""", (game_pk,)).fetchone()
    if not row:
        return None
    import json as _json
    try:
        tokens = _json.loads(row["token_ids"] or "[]")  # [row-home, row-away]
    except _json.JSONDecodeError:
        return None
    if len(tokens) < 2:
        return None
    mids = await clob.fetch_mid_prices([t for t in tokens if t])
    aligned = row["home_team"] == mlb_home_name
    return mids.get(tokens[0] if aligned else tokens[1])


async def _final_score(t: dict) -> dict | None:
    """Final runs once the schedule says Final. One light linescore fetch."""
    try:
        st = await mlb_client.linescore_state(
            t["game_pk"], t.get("away_name") or "", t.get("home_name") or "", "Final")
    except Exception as e:
        log.warning("comeback outcome: final linescore %s failed: %s", t["game_pk"], e)
        return None
    away, home = st["away"].get("runs"), st["home"].get("runs")
    if away is None or home is None:
        return None
    return {
        "away_runs": away, "home_runs": home,
        # the question the trigger exists to ask: did the home side pull it off?
        "home_won": home > away,
        "recorded_at": _now().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


async def record() -> None:
    """One pass over triggers still owed data — called on a timer."""
    pending = store.pending_outcomes()
    if not pending:
        return
    now = _now()
    for t in pending:
        fired_at = _parse(t.get("detected_at") or t["created_at"])
        if not fired_at:
            continue
        outcome = t.get("outcome") or {"samples": {}}
        outcome.setdefault("samples", {})
        changed = False

        for m in SAMPLE_MINUTES:
            key = str(m)
            if key in outcome["samples"]:
                continue
            due = fired_at + timedelta(minutes=m)
            if now < due:
                continue
            if now > due + timedelta(minutes=SAMPLE_SLACK_MIN):
                outcome["samples"][key] = None  # moment missed; stay honest
                changed = True
                continue
            price = None
            try:
                price = await _home_price(t["game_pk"], t.get("home_name") or "")
            except Exception as e:
                log.warning("comeback outcome: price sample %s+%sm failed: %s",
                            t["game_pk"], m, e)
            outcome["samples"][key] = {
                "home_cents": price,
                "at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            } if price is not None else None
            changed = True
            if price is not None:
                base = t.get("home_price_cents")
                log.info("comeback outcome: %s +%dm home %s¢ (trigger %s¢, %+.1f)",
                         t["game_pk"], m, price, base,
                         (price - base) if base is not None else 0.0)

        if "final" not in outcome and mlb_live.schedule_status(t["game_pk"]) == "Final":
            final = await _final_score(t)
            if final:
                outcome["final"] = final
                changed = True
                log.info("comeback outcome: %s FINAL %s-%s — home %s",
                         t["game_pk"], final["away_runs"], final["home_runs"],
                         "WON (comeback landed)" if final["home_won"] else "lost")

        if changed:
            store.save_outcome(t["id"], outcome)
