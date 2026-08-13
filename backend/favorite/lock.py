"""The lock job — snapshot each game's Clear Favorite verdict shortly before
first pitch, then never touch it again.

Runs every minute. A game is locked when it is inside LOCK_MINUTES of its
first pitch and has not been locked already. The snapshot uses the LIVE CLOB
midpoint, not the screener cache: the cache is rebuilt every 15 minutes and
freezing a quarter-hour-old price would defeat the point of locking at all.

Deliberately does NOT lock a game whose first pitch has passed. Scoring an
in-play game means feeding in-play prices to a pre-game model, which is the
exact bug this replaces. A game we miss (service down over its lock window)
stays unlocked and the UI says so, rather than inventing a number.
"""

import json
import logging
from datetime import datetime, timedelta, timezone

from backend.database.db import get_db
from backend.favorite import engine
from backend.favorite import store as fav_store
from backend.polymarket import clob

log = logging.getLogger(__name__)

# how long before first pitch the verdict is taken (client: "just 5 min before")
LOCK_MINUTES = 5
# a game whose first pitch passed this long ago is never locked retroactively
GRACE_MINUTES = 2


def _rows_near_first_pitch(now: datetime) -> list[dict]:
    """Baseball games whose first pitch is inside the lock window."""
    lo = (now - timedelta(minutes=GRACE_MINUTES)).isoformat().replace("+00:00", "Z")
    hi = (now + timedelta(minutes=LOCK_MINUTES)).isoformat().replace("+00:00", "Z")
    with get_db() as conn:
        return [dict(r) for r in conn.execute(
            """SELECT game_pk, home_team, away_team, home_price, away_price,
                      token_ids, kickoff
               FROM screener_cache
               WHERE sport='baseball' AND game_pk IS NOT NULL
                 AND kickoff IS NOT NULL AND kickoff > ? AND kickoff <= ?""",
            (lo, hi))]


async def _live_prices(tokens: list[str]) -> dict[str, float | None]:
    """Current midpoints for this game's two outcome tokens."""
    live = [t for t in tokens if t]
    if not live:
        return {}
    return await clob.fetch_mid_prices(live)


async def lock_due_games():
    """One pass. Safe to call every minute; already-locked games are skipped."""
    now = datetime.now(timezone.utc)
    rows = _rows_near_first_pitch(now)
    if not rows:
        return
    already = fav_store.locked_pks([r["game_pk"] for r in rows])
    due = [r for r in rows if r["game_pk"] not in already]
    if not due:
        return

    log.info("favorite lock: %d game(s) due", len(due))
    for row in due:
        try:
            tokens = json.loads(row["token_ids"] or "[]")
        except json.JSONDecodeError:
            tokens = []
        # token_ids is [row-home, row-away] in the SCREENER's orientation, the
        # same orientation as home_price/away_price — engine.score_game
        # re-assigns the sides by team NAME, so we only have to keep the pair
        # consistent with the prices we hand it.
        home_price, away_price = row["home_price"], row["away_price"]
        try:
            mids = await _live_prices(tokens)
            if len(tokens) > 0 and mids.get(tokens[0]) is not None:
                home_price = mids[tokens[0]]
            if len(tokens) > 1 and mids.get(tokens[1]) is not None:
                away_price = mids[tokens[1]]
        except Exception as e:  # a pricing hiccup must not skip the lock
            log.warning("favorite lock: live price failed for %s (%s); "
                        "falling back to the cached price", row["game_pk"], e)

        try:
            verdict = await engine.score_game(row["game_pk"], {
                "home_team": row["home_team"], "away_team": row["away_team"],
                "home_price": home_price, "away_price": away_price,
                "home_token": tokens[0] if len(tokens) > 0 else None,
                "away_token": tokens[1] if len(tokens) > 1 else None,
            }, use_cache=False)
        except Exception as e:
            log.warning("favorite lock: scoring %s failed: %s", row["game_pk"], e)
            continue
        if not verdict:
            continue

        fav_store.put(
            row["game_pk"],
            now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            (verdict.get("game_date") or "")[:10] or None,
            row["kickoff"],
            verdict)
        fav = verdict.get("favorite")
        log.info("favorite lock: %s locked (%s) away=%s home=%s",
                 row["game_pk"],
                 verdict.get(f"{fav}_name") if fav else "no clear favorite",
                 verdict["away"]["total"], verdict["home"]["total"])
