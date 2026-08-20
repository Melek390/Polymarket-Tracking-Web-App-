"""The Bottom-8th tracker: spot the games, then follow them to the end.

THE MOMENT (client spec): a game tied at the MIDDLE of the 8th — the top of
the 8th is over and the bottom is about to start. MLB reports that break as
inningState "Middle", which is the same signal the comeback detector fires
on, and it lasts a couple of minutes, so a poll every few seconds cannot
miss it. A game already in the bottom of the 8th with nobody out and still
tied is accepted too, so a restart during the break does not lose the game.

AFTER THAT, until the last out: the best price each side reaches, the score
and home price at the start of the bottom 9th (there isn't always one — if
the home team leads after the top of the 9th the game just ends), whether it
went to extras, and the final score.

Reads cost nothing upstream: game state comes from the MLB live cache this
app already polls, and prices from the live-price cache. The only calls this
module makes are one official-date lookup per new game and one linescore per
game at the end, when it has dropped off the live list.
"""

import logging

from backend.bottom8 import store
from backend.favorite import data as fav_data
from backend.mlb import live as mlb_live
from backend.screener import live_prices

log = logging.getLogger(__name__)


def _is_middle_of(inning: int, st: dict) -> bool:
    """The break between the top and the bottom of `inning`."""
    return st.get("inning") == inning and st.get("inning_state") == "Middle"


def _just_started_bottom(inning: int, st: dict) -> bool:
    """Bottom of `inning` under way with nobody out — the catch-up path for a
    break we were not running for."""
    return (st.get("inning") == inning
            and st.get("inning_state") == "Bottom"
            and (st.get("outs") or 0) == 0)


async def _open(pk: int, st: dict) -> None:
    away, home = st["away"], st["home"]
    prices = live_prices.game_prices(pk, home["name"])
    slug = prices["slug"]
    if slug:
        # keep this game priced even with no browser open: the highs below
        # are only as good as the samples behind them
        live_prices.request(slug)
        if prices["home_cents"] is None:
            fresh = await live_prices.fetch_now(slug)
            prices = live_prices.game_prices(pk, home["name"])
    info = await fav_data.game_info(pk)
    game_date = (info or {}).get("official_date") or ""
    if store.open_row({
        "game_pk": pk, "game_date": game_date, "slug": slug,
        "away_name": away["name"], "home_name": home["name"],
        "away_abbr": away.get("abbr"), "home_abbr": home.get("abbr"),
        "runs": away.get("runs") or 0,
        "home_price": prices["home_cents"], "away_price": prices["away_cents"],
    }):
        log.info("bottom8: TRACKING %s %s @ %s tied %s-%s at the 8th "
                 "(home %sc / away %sc)", pk, away.get("abbr"), home.get("abbr"),
                 away.get("runs"), home.get("runs"),
                 prices["home_cents"], prices["away_cents"])


def _follow_live(row: dict, st: dict) -> None:
    """A tracked game that is still in progress."""
    pk = row["game_pk"]
    fields = {}
    prices = live_prices.game_prices(pk, row["home_name"])
    if row["slug"]:
        live_prices.request(row["slug"])
    for side in ("home", "away"):
        now = prices[f"{side}_cents"]
        if now is None:
            continue
        best, worst = row[f"{side}_high"], row[f"{side}_low"]
        if best is None or now > best:
            fields[f"{side}_high"] = now
        if worst is None or now < worst:
            fields[f"{side}_low"] = now

    # the start of the bottom of the 9th, recorded once
    if row["b9_away_runs"] is None and (_is_middle_of(9, st)
                                        or _just_started_bottom(9, st)):
        fields["b9_away_runs"] = st["away"].get("runs")
        fields["b9_home_runs"] = st["home"].get("runs")
        fields["b9_home_price"] = prices["home_cents"]
    store.update(pk, fields)


async def _finish(row: dict) -> None:
    """A tracked game that has left the live list — settle it if it is over."""
    pk = row["game_pk"]
    if mlb_live.schedule_status(pk) not in ("Final", None):
        return
    st = await mlb_live.light_state(pk)
    if not st or st.get("status") != "Final":
        return
    away, home = st["away"].get("runs"), st["home"].get("runs")
    if away is None or home is None:
        return
    last_inning = st.get("inning") or 9
    store.update(pk, {
        "final_away": away, "final_home": home,
        "winner": "home" if home > away else "away" if away > home else None,
        "extras_inning": last_inning if last_inning > 9 else None,
        "status": "final",
    })
    log.info("bottom8: FINAL %s %s-%s %s%s", pk, away, home,
             "home" if home > away else "away",
             f" in {last_inning}" if last_inning > 9 else "")


async def run() -> None:
    """One pass — called on a timer."""
    live = dict(mlb_live.live_states())

    for pk, st in live.items():
        if st.get("status") != "Live":
            continue
        away, home = st["away"].get("runs"), st["home"].get("runs")
        if away is None or home is None or away != home:
            continue
        if _is_middle_of(8, st) or _just_started_bottom(8, st):
            await _open(pk, st)

    for row in store.tracking():
        st = live.get(row["game_pk"])
        if st and st.get("status") == "Live":
            _follow_live(row, st)
        else:
            await _finish(row)
