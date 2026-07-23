"""Server-side collector — APScheduler jobs, one per distinct poll interval.
Runs inside the FastAPI process and keeps polling with the browser closed."""

import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from backend.config.settings import settings
from backend.database import db
from backend.polymarket import clob
from backend.screener import cache

log = logging.getLogger(__name__)
scheduler = AsyncIOScheduler(timezone="UTC")

# consecutive polls where a market's tokens were absent from the CLOB response;
# after CLOSE_AFTER_MISSES in a row the market is considered resolved
_misses: dict[int, int] = {}
CLOSE_AFTER_MISSES = 3


def utc_now() -> str:
    """Current UTC time in the ISO format ticks are stored with."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


async def poll(interval: int):
    """One poll cycle: fetch prices for every tracked outcome on this interval and store them."""
    outcomes = [o for o in db.tracked_outcomes() if o["poll_interval"] == interval]
    if not outcomes:
        return

    token_to_outcome = {o["token_id"]: o["outcome_id"] for o in outcomes}
    try:
        prices = await clob.fetch_midpoints(list(token_to_outcome))
    except RuntimeError as e:
        log.warning("poll(%ss) skipped: %s", interval, e)
        return

    ts = utc_now()
    # The CLOB omits tokens with no active order book, so we build rows from
    # the response, never the request. Prices arrive as 0..1; we store cents.
    rows = [
        (token_to_outcome[token], ts, round(price * 100, 2))
        for token, price in prices.items()
        if token in token_to_outcome
    ]
    if rows:
        db.insert_ticks(rows)
    log.debug("poll(%ss): stored %d ticks", interval, len(rows))

    # closed-market detection: every token gone from the response, several
    # polls in a row, means Polymarket resolved the market and pulled its book
    market_tokens: dict[int, list[str]] = {}
    for o in outcomes:
        market_tokens.setdefault(o["market_id"], []).append(o["token_id"])
    for market_id, tokens in market_tokens.items():
        if any(t in prices for t in tokens):
            _misses.pop(market_id, None)
            continue
        _misses[market_id] = _misses.get(market_id, 0) + 1
        if _misses[market_id] >= CLOSE_AFTER_MISSES:
            _misses.pop(market_id, None)
            db.set_closed(market_id, ts)
            log.info("market %s closed on Polymarket — polling stopped", market_id)
            sync_jobs()


def sync_jobs():
    """Add or remove polling jobs so they match what the database says is tracked."""
    wanted = {f"poll-{o['poll_interval']}" for o in db.tracked_outcomes()}
    current = {job.id for job in scheduler.get_jobs()}

    for job_id in wanted - current:
        interval = int(job_id.removeprefix("poll-"))
        scheduler.add_job(
            poll, "interval", seconds=interval, args=[interval], id=job_id
        )
        log.info("collector: started %ss polling job", interval)

    for job_id in current - wanted:
        scheduler.remove_job(job_id)
        log.info("collector: removed %s", job_id)


def start():
    """Init the database and kick off polling — called once at app startup."""
    db.init_db()
    sync_jobs()
    # keep the screener cache fresh; first run right away so it is never empty
    scheduler.add_job(
        cache.refresh,
        "interval",
        minutes=settings.screener_refresh_minutes,
        id="screener-cache",
        next_run_time=datetime.now(timezone.utc),
    )
    scheduler.start()


def stop():
    """Shut the scheduler down without waiting for in-flight polls."""
    scheduler.shutdown(wait=False)
