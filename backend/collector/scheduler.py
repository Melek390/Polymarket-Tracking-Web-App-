"""Server-side collector — APScheduler jobs, one per distinct poll interval.
Runs inside the FastAPI process and keeps polling with the browser closed."""

import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from backend.config.settings import settings
from backend.comeback import detector as comeback_detector
from backend.comeback import outcomes as comeback_outcomes
from backend.database import db
from backend.favorite import lock as favorite_lock
from backend.mlb import live as mlb_live
from backend.mlb import timeline as mlb_timeline
from backend.polymarket import clob
from backend.screener import cache
from backend.screener import live_prices

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


_game_pk_cache: dict[str, int | None] = {}  # slug -> gamePk (a slug never moves)


async def sync_mlb_intervals():
    """Poll an MLB market every second only while its game is in progress.

    1s sampling is what makes the feed-lag measurement possible, but running it
    around the clock on finished games just writes pinned prices forever (~140
    MB/day). Live games get settings.mlb_poll_interval, everything else falls
    back to the normal interval."""
    rows = db.mlb_tracked_markets()
    if not rows:
        return
    try:
        await mlb_live._refresh_schedule()
    except Exception as e:
        log.warning("mlb interval sync: schedule refresh failed: %s", e)
        return

    changed = False
    for r in rows:
        slug = r["slug"]
        pk = _game_pk_cache.get(slug)
        if pk is None:
            # Only a SUCCESSFUL lookup is cached. Caching a failure would pin
            # the market at the slow interval forever after one transient MLB
            # error; this way the next cycle simply tries again.
            try:
                pk = await mlb_timeline.resolve_game_pk(slug)
            except Exception:
                pk = None
            if pk is not None:
                _game_pk_cache[slug] = pk
        live = pk is not None and mlb_live._sched.get(pk, {}).get("status") == "Live"
        want = settings.mlb_poll_interval if live else settings.default_poll_interval
        if r["poll_interval"] != want:
            db.set_poll_interval(r["id"], want)
            log.info("collector: %s -> %ss (%s)", slug, want, "live" if live else "not live")
            changed = True
    if changed:
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

    # Only ever remove the collector's own per-interval poll jobs. The named
    # background jobs (screener-cache, mlb-live, live-prices) are not in
    # `wanted`, so without this guard a market closing would wipe them out.
    for job_id in current - wanted:
        if not job_id.startswith("poll-"):
            continue
        scheduler.remove_job(job_id)
        log.info("collector: removed %s", job_id)


def start():
    """Init the database and kick off polling — called once at app startup."""
    db.init_db()
    sync_jobs()
    # keep the screener cache fresh; first run right away so it is never empty
    scheduler.add_job(
        cache.refresh_all,
        "interval",
        minutes=settings.screener_refresh_minutes,
        id="screener-cache",
        next_run_time=datetime.now(timezone.utc),
    )
    # poll live MLB games server-side so browsers read a shared cache
    scheduler.add_job(
        mlb_live.poll, "interval", seconds=settings.mlb_poll_seconds, id="mlb-live"
    )
    # poll live CLOB prices server-side for the games being viewed, so browsers
    # read a shared cache instead of each poll hitting the CLOB
    scheduler.add_job(
        live_prices.poll, "interval", seconds=settings.live_price_poll_seconds, id="live-prices"
    )
    # move MLB markets between 1s (game in progress) and the normal interval
    scheduler.add_job(
        sync_mlb_intervals, "interval", seconds=60, id="mlb-intervals",
        next_run_time=datetime.now(timezone.utc),
    )
    # snapshot each game's Clear Favorite verdict ~5 min before first pitch and
    # never recompute it. Every minute so the lock lands inside its window; the
    # job is a no-op unless a game is actually due.
    scheduler.add_job(
        favorite_lock.lock_due_games, "interval", seconds=60, id="favorite-lock",
        next_run_time=datetime.now(timezone.utc),
    )
    # watch live games for the Comeback Setup (tired reliever protecting a
    # 1-run/tied lead late). Reads the mlb-live in-process cache, so this
    # cadence costs no upstream requests at all.
    scheduler.add_job(
        comeback_detector.run, "interval", seconds=10, id="comeback-detector",
    )
    # fill in each trigger's outcome (price 5/15/30 min later + final score) —
    # a couple of CLOB tokens per open trigger, so the volume is negligible
    scheduler.add_job(
        comeback_outcomes.record, "interval", seconds=60, id="comeback-outcomes",
    )
    scheduler.start()


def stop():
    """Shut the scheduler down without waiting for in-flight polls."""
    scheduler.shutdown(wait=False)
