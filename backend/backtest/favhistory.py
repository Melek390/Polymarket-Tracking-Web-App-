"""Reconstruct the Clear Favorite verdict at T-5 for HISTORICAL games.

The live system only started locking verdicts on Aug 13; the corpus reaches
back to May. This module re-runs the same 100-point computation for each past
game at five minutes before its first pitch, from data as it stood THEN:

  market    our own pre-game ticks: the price at T-5 and the day's opening
            price (first tick after 10:00 UTC on the game's date)
  sp        both probables' season lines from the game's own boxscore
            seasonStats — MLB stamps those as-of that game, so a June start
            carries June numbers, not September's
  lineup    starters from the boxscore battingOrder; "top five bats" ranked
            by as-of OPS from the same boxscore
  strength/ team season schedules sliced to the date: Pythagorean from
  form/rest to-date runs, last-10 form, rest days + park-to-park miles
  park      the static park table; historical weather is NOT replayed

APPROXIMATIONS, carried in every payload rather than hidden:
  - the SD scale for pitcher ratings uses the CURRENT league distribution
    (player values are as-of; only the yardstick is season-end)
  - bullpen quality uses the CURRENT season rank; 3-day workload is unknown
  - weather unknown -> the park factor's conservative 2, no extreme flag
  - a pre-game ?timecode= boxscore is used when MLB serves one; otherwise the
    final boxscore stands in (seasonStats then include the game itself)
"""

import asyncio
import logging
import statistics
from datetime import datetime, timedelta, timezone

from backend.backtest import store
from backend.database.db import get_db
from backend.favorite import market as fav_market
from backend.favorite.data import STADIUMS, game_info, league_pitching, park_miles
from backend.mlb import client

log = logging.getLogger(__name__)

CONCURRENCY = 4
T5_MIN = 5
APPROXIMATIONS = [
    "pitcher SD scale = current league distribution",
    "bullpen rank = current season, workload unknown",
    "weather not replayed",
]

_BOX_FIELDS = ("teams,away,home,players,person,id,battingOrder,seasonStats,"
               "batting,ops,plateAppearances,pitching,era,whip,strikeOuts,"
               "inningsPitched")

_sched_cache: dict[int, list[dict]] = {}     # team_id -> season schedule rows
_league_scale: dict | None = None


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ip(text) -> float:
    try:
        whole, _, frac = str(text or "0").partition(".")
        return int(whole or 0) + int(frac or 0) / 3
    except ValueError:
        return 0.0


async def _league_sd_scale() -> dict:
    """Mean/SD of ERA, WHIP and K9 over the current starters table — the
    yardstick the as-of pitcher values are rated against (flagged approx)."""
    global _league_scale
    if _league_scale:
        return _league_scale
    table = (await league_pitching())["starters"]
    rows = [p for p in table.values() if p.get("regular_starter", True)]
    def ms(vals):
        return (statistics.mean(vals), statistics.pstdev(vals) or 1.0)
    _league_scale = {
        "era": ms([p["era"] for p in rows]),
        "whip": ms([p["whip"] for p in rows]),
        "k9": ms([p["k9"] for p in rows]),
    }
    return _league_scale


def _rating(scale: dict, era: float, whip: float, k9: float) -> float:
    return (((scale["era"][0] - era) / scale["era"][1])
            + ((scale["whip"][0] - whip) / scale["whip"][1])
            + ((k9 - scale["k9"][0]) / scale["k9"][1])) / 3


async def _team_season(team_id: int, season: int) -> list[dict]:
    """The team's whole regular season, one cached fetch — sliced per date by
    the callers."""
    if team_id in _sched_cache:
        return _sched_cache[team_id]
    r = await client._http().get(
        f"{client.BASE}/v1/schedule",
        params={"sportId": 1, "teamId": team_id, "gameType": "R",
                "season": season, "startDate": f"{season}-03-01",
                "endDate": f"{season}-11-30"})
    r.raise_for_status()
    rows = []
    for d in r.json().get("dates", []):
        for g in d.get("games", []):
            t = g["teams"]
            mine = "home" if t["home"]["team"]["id"] == team_id else "away"
            other = "away" if mine == "home" else "home"
            rows.append({
                "date": d.get("date"),
                "final": g["status"]["abstractGameState"] == "Final",
                "home": mine == "home",
                "opp_id": t[other]["team"]["id"],
                "won": bool(t[mine].get("isWinner")),
                "my_runs": t[mine].get("score"),
                "opp_runs": t[other].get("score"),
            })
    rows.sort(key=lambda x: x["date"] or "")
    _sched_cache[team_id] = rows
    return rows


def _prior(rows: list[dict], date: str) -> list[dict]:
    return [g for g in rows if g["final"] and (g["date"] or "") < date]


# ---- per-factor reconstructions (bands mirror backend/favorite/*) ---------

def _strength(prior_mine, prior_theirs) -> dict:
    def pyth(rows):
        rs = sum(g["my_runs"] or 0 for g in rows)
        ra = sum(g["opp_runs"] or 0 for g in rows)
        if not rs or not ra:
            return 0.5
        return rs ** 1.83 / (rs ** 1.83 + ra ** 1.83)
    if len(prior_mine) < 10 or len(prior_theirs) < 10:
        return {"key": "strength", "points": 0, "max": 12, "ok": False,
                "detail": "to-date sample too thin"}
    edge = (pyth(prior_mine) - pyth(prior_theirs)) * 100
    pts = 12 if edge >= 8 else 7 if edge >= 4 else 4 if edge >= 2 else 2 if edge >= 1 else 0
    return {"key": "strength", "points": pts, "max": 12, "ok": True,
            "detail": f"to-date Pythagorean edge {edge:+.1f}pp"}


def _form(prior) -> dict:
    last10 = prior[-10:]
    if len(last10) < 5:
        return {"key": "form", "points": 2, "max": 5, "ok": True,
                "detail": "thin sample (neutral)"}
    wins = sum(1 for g in last10 if g["won"])
    diff = sum((g["my_runs"] or 0) - (g["opp_runs"] or 0) for g in last10)
    if wins >= 7 or (wins >= 6 and diff >= 10):
        pts = 5
    elif wins >= 6 or (wins >= 5 and diff > 0):
        pts = 3
    elif wins >= 4:
        pts = 2
    else:
        pts = 1 if diff > -15 else 0
    return {"key": "form", "points": pts, "max": 5, "ok": True,
            "detail": f"last {len(last10)}: {wins}W, run diff {diff:+d}"}


def _rest(prior_mine, prior_theirs, team_id, opp_id, home_id, game_date) -> dict:
    def spot(prior, tid):
        if not prior:
            return {"rest": None, "miles": None}
        last = prior[-1]
        days = (datetime.fromisoformat(game_date)
                - datetime.fromisoformat(last["date"])).days - 1
        if days > 4:
            return {"rest": None, "miles": None}
        park_team = tid if last["home"] else last["opp_id"]
        return {"rest": max(0, days), "miles": park_miles(park_team, home_id)}
    mine, theirs = spot(prior_mine, team_id), spot(prior_theirs, opp_id)
    if mine["rest"] is None or theirs["rest"] is None:
        return {"key": "rest", "points": 5, "max": 10, "ok": True,
                "detail": "schedule edge unknown (neutral)"}
    long = lambda s: s["miles"] is not None and s["miles"] >= 900
    adv = mine["rest"] - theirs["rest"]
    if adv > 0 and (theirs["rest"] == 0 or long(theirs)):
        pts = 10
    elif adv > 0:
        pts = 7
    elif adv == 0 and long(theirs) and not long(mine):
        pts = 7
    elif adv == 0 and long(mine) and not long(theirs):
        pts = 2
    elif adv == 0:
        pts = 5
    elif adv == -1:
        pts = 2
    else:
        pts = 0
    return {"key": "rest", "points": pts, "max": 10, "ok": True,
            "detail": f"rest {mine['rest']}d vs {theirs['rest']}d"}


def _sp(scale, box_players, my_pid, opp_pid) -> dict:
    def line(pid):
        for side_players in box_players:
            p = side_players.get(f"ID{pid}")
            if p:
                s = (p.get("seasonStats") or {}).get("pitching") or {}
                ip = _ip(s.get("inningsPitched"))
                try:
                    era, whip = float(s.get("era")), float(s.get("whip"))
                except (TypeError, ValueError):
                    return None
                if ip < 30:
                    return None
                return {"era": era, "whip": whip,
                        "k9": (s.get("strikeOuts") or 0) * 9 / ip}
        return None
    if not my_pid or not opp_pid:
        return {"key": "sp", "points": 0, "max": 18, "ok": False,
                "unannounced": True, "detail": "probable unknown for this date"}
    mine, theirs = line(my_pid), line(opp_pid)
    if not mine or not theirs:
        return {"key": "sp", "points": 0, "max": 18, "ok": False, "emergency": True,
                "detail": "no qualified as-of season line (bullpen game / call-up)"}
    gap = _rating(scale, **mine) - _rating(scale, **theirs)
    pts = 18 if gap >= 2.0 else 12 if gap >= 0.7 else 8 if gap >= 0.3 else 4 if gap >= 0.1 else 0
    return {"key": "sp", "points": pts, "max": 18, "ok": True,
            "detail": f"as-of SD gap {gap:+.2f}"}


def _bullpen(pen_rank, team_id) -> dict:
    rank = pen_rank.get(team_id)
    if rank is None:
        return {"key": "bullpen", "points": 0, "max": 12, "ok": False,
                "detail": "no bullpen data"}
    pts = 12 if rank <= 8 else 8 if rank <= 15 else 5 if rank <= 22 else 2 if rank <= 26 else 0
    return {"key": "bullpen", "points": pts, "max": 12, "ok": True,
            "detail": f"pen rank #{rank} (current season), workload unknown"}


def _lineup(box_side) -> dict:
    players = box_side.get("players") or {}
    starters, bats = [], []
    for p in players.values():
        order = p.get("battingOrder")
        try:
            order = int(order)
        except (TypeError, ValueError):
            continue
        pid = (p.get("person") or {}).get("id")
        if order % 100 == 0 and pid:
            starters.append(pid)
    for p in players.values():
        s = (p.get("seasonStats") or {}).get("batting") or {}
        pid = (p.get("person") or {}).get("id")
        try:
            ops, pa = float(s.get("ops")), int(s.get("plateAppearances") or 0)
        except (TypeError, ValueError):
            continue
        if pid and pa >= 150:
            bats.append((ops, pid))
    if not starters:
        return {"key": "lineup", "points": 6, "max": 10, "ok": True,
                "detail": "no batting order in the boxscore (neutral)"}
    top = [pid for _, pid in sorted(bats, reverse=True)[:5]]
    if len(top) < 5:
        return {"key": "lineup", "points": 10, "max": 10, "ok": True,
                "detail": "thin as-of hitter sample"}
    present = sum(1 for pid in top if pid in starters)
    pts = {5: 10, 4: 6, 3: 3}.get(present, 0)
    return {"key": "lineup", "points": pts, "max": 10, "ok": True,
            "detail": f"{present}/5 as-of top bats started"}


def _park(home_id) -> dict:
    pf = (STADIUMS.get(home_id) or (None, None, 100))[2]
    return {"key": "park", "points": 2, "max": 5, "ok": True,
            "detail": f"park factor {pf}, weather unknown"}


async def _one_game(g: dict, scale: dict, pen_rank: dict):
    pk, mid = g["game_pk"], g["market_id"]
    info = await game_info(pk)
    if not info or not info.get("game_date"):
        return
    first_pitch = datetime.fromisoformat(info["game_date"].replace("Z", "+00:00"))
    t5 = _iso(first_pitch - timedelta(minutes=T5_MIN))
    date = (info.get("official_date") or "")[:10]
    if not date:
        return

    # our own pre-game prices
    t5_home = store.tick_price_at(g["home_outcome_id"], t5)
    t5_away = store.tick_price_at(g["away_outcome_id"], t5)
    day_open = {}
    for side, oid in (("home", g["home_outcome_id"]), ("away", g["away_outcome_id"])):
        day_open[side] = store.tick_price_at(oid, f"{date}T10:00:00Z", max_lag_s=8 * 3600)

    # boxscore as of T-5 when MLB serves it; the final boxscore otherwise
    box = None
    for params in ({"timecode": first_pitch.strftime("%Y%m%d_%H%M%S"),
                    "fields": _BOX_FIELDS},
                   {"fields": _BOX_FIELDS}):
        try:
            r = await client._http().get(f"{client.BASE}/v1/game/{pk}/boxscore",
                                         params=params)
            r.raise_for_status()
            box = r.json().get("teams") or {}
            if box:
                break
        except Exception:
            continue
    if not box:
        return
    box_players = [((box.get("away") or {}).get("players") or {}),
                   ((box.get("home") or {}).get("players") or {})]

    season = int(date[:4])
    sched = {}
    for side in ("away", "home"):
        sched[side] = _prior(await _team_season(info[f"{side}_id"], season), date)

    sides = {}
    for side in ("away", "home"):
        opp = "home" if side == "away" else "away"
        price = t5_home if side == "home" else t5_away
        factors = [
            fav_market.score(price, day_open.get(side)),
            _sp(scale, box_players, info["probables"].get(side),
                info["probables"].get(opp)),
            _bullpen(pen_rank, info[f"{side}_id"]),
            _strength(sched[side], sched[opp]),
            _rest(sched[side], sched[opp], info[f"{side}_id"], info[f"{opp}_id"],
                  info["home_id"], date),
            _lineup(box.get(side) or {}),
            _form(sched[side]),
            _park(info["home_id"]),
        ]
        total = sum(f["points"] for f in factors)
        top4_missing = [f["key"] for f in factors
                        if f["key"] in ("market", "sp", "bullpen", "strength")
                        and not f["ok"] and not f.get("unannounced")]
        disq = []
        if any(f.get("below_59") for f in factors):
            disq.append("price below 59¢")
        if any(f.get("emergency") for f in factors):
            disq.append("bullpen game / emergency starter")
        if top4_missing:
            disq.append(f"data missing: {', '.join(top4_missing)}")
        sides[side] = {"total": round(total, 1),
                       "qualifies": total >= 75 and not disq,
                       "disqualifiers": disq, "flags": [],
                       "factors": [{k: f.get(k) for k in ("key", "points", "max", "detail")}
                                   for f in factors]}

    favorite = None
    if sides["away"]["qualifies"] and sides["home"]["qualifies"]:
        favorite = ("away" if sides["away"]["total"] > sides["home"]["total"]
                    else "home" if sides["home"]["total"] > sides["away"]["total"] else None)
    elif sides["away"]["qualifies"]:
        favorite = "away"
    elif sides["home"]["qualifies"]:
        favorite = "home"

    store.save_fav_history(pk, mid, t5, {
        "game_pk": pk, "favorite": favorite, "synthetic": True,
        "away_name": g["mlb_away"], "home_name": g["mlb_home"],
        "game_date": date, "first_pitch": info["game_date"],
        "away": sides["away"], "home": sides["home"],
        "t5_prices": {"home": t5_home, "away": t5_away},
        "approximations": APPROXIMATIONS,
    })
    log.info("fav history: %s reconstructed (away %s / home %s%s)",
             pk, sides["away"]["total"], sides["home"]["total"],
             f", favorite={favorite}" if favorite else "")


_status = {"running": False}


async def run_batch(limit: int = 120) -> dict:
    if _status["running"]:
        return {"running": True}
    _status["running"] = True
    try:
        pending = store.fav_history_pending(limit)
        if not pending:
            return {"running": False, "batch": 0}
        log.info("fav history: %d game(s) this pass", len(pending))
        scale = await _league_sd_scale()
        pen_rank = (await league_pitching())["pen_rank"]
        sem = asyncio.Semaphore(CONCURRENCY)

        async def one(g):
            async with sem:
                try:
                    await _one_game(g, scale, pen_rank)
                except Exception as e:  # noqa: BLE001
                    log.warning("fav history: %s failed: %s", g["game_pk"], e)

        await asyncio.gather(*(one(g) for g in pending))
        return {"running": False, "batch": len(pending)}
    finally:
        _status["running"] = False


def status() -> dict:
    with get_db() as conn:
        done = conn.execute("SELECT COUNT(*) c FROM backtest_fav_history").fetchone()["c"]
    return {"running": _status["running"], "reconstructed": done,
            "pending": len(store.fav_history_pending(10_000))}
