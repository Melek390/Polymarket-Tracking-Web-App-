"""Server-side live-price cache. One background job fetches the CLOB best-ask
for the games people are actually looking at, on a short cycle. Browsers read
this cache (instant, no CLOB call), so how fast a viewer polls is decoupled
from our Polymarket request rate — many rows / tabs / a 2s refresh all share
one fetch per game per cycle. Same idea as the MLB state cache."""

import json
import logging
import time

from backend.database import db
from backend.polymarket import clob

log = logging.getLogger(__name__)

_prices: dict[str, dict] = {}   # slug -> {home, away[, draw]} in cents
_at: dict[str, float] = {}      # slug -> monotonic time last priced
_wanted: dict[str, float] = {}  # slug -> monotonic time last requested by a browser
WANT_TTL = 90                   # keep pricing a game this long after the last view


def _shape(tokens: list) -> list[str]:
    return ["home", "away"] if len(tokens) == 2 else ["home", "draw", "away"]


def request(slug: str) -> None:
    """Mark a game as being viewed so the poller keeps its price fresh."""
    _wanted[slug] = time.monotonic()


def cached(slug: str) -> dict | None:
    return _prices.get(slug)


async def fetch_now(slug: str) -> dict:
    """One-off fetch for a cold miss (a game viewed for the first time), so the
    first response isn't empty. The poller keeps it warm afterwards."""
    tokens = db.screener_token_ids(slug)
    if not tokens or len([t for t in tokens if t]) < 2:
        return {}
    prices = await clob.fetch_buy_prices([t for t in tokens if t])
    result = {k: (prices.get(t) if t else None) for k, t in zip(_shape(tokens), tokens)}
    _prices[slug] = result
    _at[slug] = time.monotonic()
    return result


async def poll() -> None:
    """Re-price every game viewed in the last WANT_TTL seconds, in one batch."""
    now = time.monotonic()
    wanted = {s for s, t in _wanted.items() if now - t < WANT_TTL}
    if not wanted:
        return
    live = [
        (r["event_slug"], toks)
        for r in db.live_screener_tokens()
        if r["event_slug"] in wanted
        and (toks := json.loads(r["token_ids"] or "[]"))
        and len([t for t in toks if t]) >= 2
    ]
    tokens = list({t for _, toks in live for t in toks if t})
    if not tokens:
        return
    try:
        prices = await clob.fetch_buy_prices(tokens)
    except Exception as e:
        log.warning("live-price poll failed: %s", e)
        return
    now = time.monotonic()
    for slug, toks in live:
        _prices[slug] = {k: (prices.get(t) if t else None) for k, t in zip(_shape(toks), toks)}
        _at[slug] = now
    # forget games nobody has viewed for a while so the maps don't grow forever
    for slug in [s for s, t in _wanted.items() if now - t >= WANT_TTL]:
        _wanted.pop(slug, None)
        _prices.pop(slug, None)
        _at.pop(slug, None)
