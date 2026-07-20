"""One-shot history backfill — when a market is first tracked, pull all the
1-minute history Polymarket has for it, alongside the live polling.

Backfill only stores points strictly BEFORE the market's created_at, and the
live collector only produces points after it, so the two can never overlap;
a unique index on (outcome_id, ts) backstops that guarantee in the database.
"""

import logging
from datetime import datetime, timezone

from backend.database import db
from backend.polymarket import clob

log = logging.getLogger(__name__)

WINDOW = 3 * 86400  # 3-day pages: the widest span the API serves at 1-min fidelity
MAX_WINDOWS = 400  # hard stop (~3 years) so we can never loop forever


def _iso(unix_ts: int) -> str:
    """Unix seconds -> the ISO format ticks are stored with."""
    return datetime.fromtimestamp(unix_ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


async def backfill_market(market_id: int):
    """Fetch each outcome's full history and store it as ticks; skips markets that already have data."""
    market = db.get_market(market_id)
    if not market:
        return
    if db.get_ticks(market_id, limit=1):
        log.info("backfill: market %s already has data, skipping", market_id)
        return

    # everything before this moment is backfill; everything after is live
    tracked_since = int(
        datetime.fromisoformat(
            market["created_at"].replace("Z", "+00:00")
        ).timestamp()
    )

    for outcome in market["outcomes"]:
        try:
            points: dict[int, float] = {}
            end = tracked_since
            for _ in range(MAX_WINDOWS):
                window = await clob.fetch_price_history(
                    outcome["token_id"], end - WINDOW, end
                )
                if not window:
                    break  # reached back before the market existed
                before = len(points)
                points.update(dict(window))
                if len(points) == before:
                    break  # API is re-serving its earliest data — we have it all
                end -= WINDOW

            # history endpoint also speaks 0..1 fractions; store cents
            rows = [
                (outcome["id"], _iso(ts), round(price * 100, 2))
                for ts, price in sorted(points.items())
                if ts < tracked_since
            ]
            if rows:
                db.insert_ticks(rows)
            log.info(
                "backfill: market %s '%s' -> %d points",
                market_id, outcome["label"], len(rows),
            )
        except Exception as e:
            log.warning(
                "backfill: market %s '%s' failed: %s",
                market_id, outcome["label"], e,
            )
