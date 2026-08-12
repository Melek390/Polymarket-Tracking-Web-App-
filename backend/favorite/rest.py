"""Factor 5 — Rest / travel / schedule spot (max 10).

From the two teams' schedules: days off before today, and how far they had to
travel to get here. The spec's top band is "extra day of rest AND the opponent
on short rest OR long travel" — an OR, which the first cut had as an AND, so
10/10 could effectively never fire.

Travel is now real mileage between the last park and today's, not "did the
venue change": Yankees -> Boston is 190 miles and Seattle -> Miami is 2700,
and only one of those is a schedule burden.
"""

from datetime import datetime

from backend.favorite import data

MAX = 10
# a coast-to-coast or cross-country hop, not a division bus ride
LONG_TRAVEL_MILES = 900
# an in-season club gets at most a couple of days off; anything beyond this
# means we are looking past the edge of the schedule we fetched
MAX_PLAUSIBLE_REST = 4


async def _spot(team_id: int, park_team: int | None, game_date: str) -> dict:
    """Days off before THIS GAME, and the miles travelled to reach its park.

    Anchored to the game's own date, not to today. The first cut measured
    everything against `datetime.now()`, so every one of the ~65 future-dated
    games the screener carries reported "rest 0d vs 0d" — it compared a game
    three days out against yesterday's result and ignored the games both clubs
    play in between. That is why the factor read a flat 5/10 all the way down
    the upcoming list."""
    sched = await data.team_schedule(team_id)
    today = datetime.now().date().isoformat()
    prior = []
    for g in sched:
        d = g["date"] or ""
        if not d or d >= game_date:
            continue
        # A past game that never went final was postponed — it cost them
        # nothing. A future one has not been played yet but will have been by
        # the time this game starts, so it counts.
        if not g["final"] and d < today:
            continue
        prior.append(g)
    if not prior:
        return {"rest": None, "miles": None}
    last = prior[-1]
    days = (datetime.fromisoformat(game_date)
            - datetime.fromisoformat(last["date"])).days - 1
    # An in-season club never gets close to a week off, so a gap this big means
    # the previous game is outside our schedule window, not that they are
    # rested. Say we don't know rather than invent a number.
    if days > MAX_PLAUSIBLE_REST:
        return {"rest": None, "miles": None}
    # the park they last played in belongs to that game's home club
    last_park_team = team_id if last["home"] else last["opp_id"]
    return {"rest": max(0, days),
            "miles": data.park_miles(last_park_team, park_team)}


def _long(spot: dict) -> bool:
    return spot["miles"] is not None and spot["miles"] >= LONG_TRAVEL_MILES


async def score(team_id: int, opp_id: int, home_team_id: int | None,
                game_date: str | None = None) -> dict:
    game_date = (game_date or datetime.now().date().isoformat())[:10]
    mine = await _spot(team_id, home_team_id, game_date)
    theirs = await _spot(opp_id, home_team_id, game_date)
    if mine["rest"] is None or theirs["rest"] is None:
        # neutral, and honest about why — never a fabricated edge
        return {"key": "rest", "points": 5, "max": MAX, "ok": True,
                "detail": "schedule not published this far out (neutral)"}
    adv = mine["rest"] - theirs["rest"]
    long_them, long_me = _long(theirs), _long(mine)

    if adv > 0 and (theirs["rest"] == 0 or long_them):
        pts = MAX                      # extra rest AND they are short OR far
    elif adv > 0:
        pts = 7
    elif adv == 0 and long_them and not long_me:
        # In midseason both clubs play every single day, so rest alone graded
        # all 30 teams a flat 5/10 and the factor never separated anyone. Equal
        # rest is NOT an equal spot when one side just flew across the country.
        pts = 7
    elif adv == 0 and long_me and not long_them:
        pts = 2
    elif adv == 0:
        pts = 5
    elif adv == -1:
        pts = 2
    else:
        pts = 0

    bits = [f"rest {mine['rest']}d vs {theirs['rest']}d"]
    if long_them:
        bits.append(f"opponent traveled {round(theirs['miles']):,}mi")
    if long_me:
        bits.append(f"we traveled {round(mine['miles']):,}mi")
    return {"key": "rest", "points": pts, "max": MAX, "ok": True,
            "detail": ", ".join(bits)}
