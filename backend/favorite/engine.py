"""Clear Favorite engine (client spec, Aug 11).

Scores both teams independently on the 100-point scale, then applies the
hard rules. A team is the CLEAR FAVORITE only if:
  - total >= 75, and
  - its Polymarket price >= 59c, and
  - no disqualifier fired: emergency/bullpen-game starter, missing data on
    any top-4 factor, or 2+ uncertainty flags (lineup pending near first
    pitch, extreme weather; the spec's public-betting flag has no free data
    source and was dropped with the client's knowledge).
If both clear 75 the higher score wins; an exact tie means no favorite."""

import asyncio
import time

from backend.favorite import bullpen, data, form, lineup, market, park, rest, sp, strength

THRESHOLD = 75
_result_cache: dict[int, tuple[float, dict]] = {}
RESULT_TTL = 600


async def _score_side(info: dict, side: str, game_pk: int,
                      price: float | None, opened: float | None) -> dict:
    team_id = info[f"{side}_id"]
    opp_side = "home" if side == "away" else "away"
    opp_id = info[f"{opp_side}_id"]
    factors = await asyncio.gather(
        sp.score(info["probables"].get(side), info["probables"].get(opp_side)),
        bullpen.score(team_id),
        strength.score(team_id, opp_id),
        # travel is measured park-to-park, so rest needs today's HOME club
        # (whose park this is), not the bare venue id
        rest.score(team_id, opp_id, info.get("home_id"), info.get("official_date")),
        lineup.score(team_id, game_pk, side, info.get("game_date")),
        form.score(team_id),
        park.score(info["home_id"], info.get("game_date")),
    )
    factors = [market.score(price, opened), *factors]
    total = sum(f["points"] for f in factors)

    top4_missing = [f["key"] for f in factors
                    if f["key"] in ("market", "sp", "bullpen", "strength") and not f["ok"]]
    # "probable starter not announced yet" is a clock problem, not a data one —
    # it resolves by itself as the day goes on. Reporting it as "data missing"
    # made a normal morning slate look broken.
    unannounced = [f["key"] for f in factors if f.get("unannounced")]
    # An emergency starter already gets its own line below; listing it again as
    # "data missing: sp" printed the same cause twice on the card.
    emergency = [f["key"] for f in factors if f.get("emergency")]
    top4_missing = [k for k in top4_missing
                    if k not in unannounced and k not in emergency]
    flags = []
    if any(f.get("pending") for f in factors):
        flags.append("lineup still pending near first pitch")
    if any(f.get("extreme_weather") for f in factors):
        flags.append("extreme weather")

    disqualifiers = []
    if any(f.get("below_59") for f in factors):
        disqualifiers.append("price below 59¢")
    if any(f.get("emergency") for f in factors):
        disqualifiers.append("bullpen game / emergency starter")
    if unannounced:
        disqualifiers.append("probable starter not announced yet")
    if top4_missing:
        disqualifiers.append(f"data missing: {', '.join(top4_missing)}")
    if len(flags) >= 2:
        disqualifiers.append("multiple uncertainty flags: " + "; ".join(flags))

    return {
        "total": total,
        "qualifies": total >= THRESHOLD and not disqualifiers,
        "disqualifiers": disqualifiers,
        "flags": flags,
        "factors": [{k: f[k] for k in ("key", "points", "max", "detail")} for f in factors],
    }


async def score_game(game_pk: int, row: dict, use_cache: bool = True) -> dict | None:
    """row = the screener-cache orientation: {home_team, away_team,
    home_price, away_price, home_token, away_token} in cents. Polymarket
    lists MLB games away-first, so the row's "home" is usually the MLB AWAY
    club — sides are re-assigned by matching team NAMES against the MLB
    schedule, never by position. Cached 10 min."""
    # The lock job passes use_cache=False: its whole job is to take a fresh
    # snapshot at a precise moment, and a 10-minute-old cached result would
    # silently make the "5 minutes before first pitch" promise a lie.
    hit = _result_cache.get(game_pk) if use_cache else None
    if hit and time.monotonic() - hit[0] < RESULT_TTL:
        return hit[1]
    info = await data.game_info(game_pk)
    if not info:
        return None
    aligned = (row.get("home_team") == info.get("home_name")
               or row.get("away_team") == info.get("away_name"))
    if aligned:
        home_price, home_token = row.get("home_price"), row.get("home_token")
        away_price, away_token = row.get("away_price"), row.get("away_token")
    else:  # the usual Polymarket away-first row
        home_price, home_token = row.get("away_price"), row.get("away_token")
        away_price, away_token = row.get("home_price"), row.get("home_token")
    away_open, home_open = await asyncio.gather(
        data.open_price(away_token, info.get("game_date")),
        data.open_price(home_token, info.get("game_date")))
    away, home = await asyncio.gather(
        _score_side(info, "away", game_pk, away_price, away_open),
        _score_side(info, "home", game_pk, home_price, home_open))

    favorite = None
    if away["qualifies"] and home["qualifies"]:
        favorite = ("away" if away["total"] > home["total"]
                    else "home" if home["total"] > away["total"] else None)
    elif away["qualifies"]:
        favorite = "away"
    elif home["qualifies"]:
        favorite = "home"

    result = {"game_pk": game_pk, "favorite": favorite,
              "away_name": info.get("away_name"), "home_name": info.get("home_name"),
              "game_date": info.get("official_date") or info.get("game_date"),
              "first_pitch": info.get("game_date"),
              "away": away, "home": home}
    _result_cache[game_pk] = (time.monotonic(), result)
    return result
