"""Reconstruct the Clear Favorite verdict at T-5 — for the WHOLE season.

The user's observation that unlocked this: the score is computed BEFORE the
game, so 1-second tick data is not needed. Only two inputs sit outside the
MLB API, and both have season-deep sources:

  entry price   tracked games use our own ticks (exact); every other game
                uses CLOB's settled-market history via the Gamma slug lookup
                — 10-minute bars, which pre-game prices drift slowly enough
                to make an honest T-5 approximation (price_source says which)
  the outcome   MLB's own final score — no market data needed at all

Coverage is therefore every Final regular-season game since Opening Day,
not just the 232 tracked ones. Factor sources as before, all as-of-then:
boxscore seasonStats (MLB stamps them per game), season schedules sliced to
the date, our park table. The same APPROXIMATIONS ride in every payload:
current-league SD scale for pitchers, current bullpen rank with workload
unknown, weather not replayed.
"""

import asyncio
import logging
import statistics
from datetime import datetime, timedelta, timezone

from backend.backtest import store
from backend.database.db import get_db
from backend.favorite import market as fav_market
from backend.favorite.data import STADIUMS, league_pitching, park_miles
from backend.mlb import client
from backend.polymarket import clob, gamma
from backend.offload import json_off_loop

log = logging.getLogger(__name__)

SEASON_START = "2026-03-25"          # Opening Day, with a day of slack
CONCURRENCY = 3                      # three upstream APIs share this budget
T5_MIN = 5
APPROXIMATIONS = [
    "pitcher SD scale = current league distribution",
    "bullpen rank = current season, workload unknown",
    "weather not replayed",
]

_BOX_FIELDS = ("teams,away,home,players,person,id,battingOrder,seasonStats,"
               "batting,ops,plateAppearances,pitching,era,whip,strikeOuts,"
               "inningsPitched")
_SWEEP_FIELDS = ("dates,date,games,gamePk,gameType,gameDate,status,"
                 "abstractGameState,teams,away,home,team,id,name,score,"
                 "probablePitcher")

_sched_cache: dict[int, list[dict]] = {}
_league_scale: dict | None = None
_abbr_cache: dict[str, str] | None = None

# Polymarket's slug abbreviations, where they differ from MLB's (the
# Athletics rebrand gotcha and friends — mirrors timeline._ABBR_ALIASES)
_SLUG_FORMS = {
    "ATH": ["oak", "ath"], "AZ": ["ari", "az"], "CWS": ["cws", "chw"],
    "WSH": ["wsh", "was"], "SD": ["sd", "sdp"], "SF": ["sf", "sfg"],
    "TB": ["tb", "tbr"], "KC": ["kc", "kcr"],
}


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ip(text) -> float:
    try:
        whole, _, frac = str(text or "0").partition(".")
        return int(whole or 0) + int(frac or 0) / 3
    except ValueError:
        return 0.0


async def _league_sd_scale() -> dict:
    global _league_scale
    if _league_scale:
        return _league_scale
    table = (await league_pitching())["starters"]
    rows = [p for p in table.values() if p.get("regular_starter", True)]
    def ms(vals):
        return (statistics.mean(vals), statistics.pstdev(vals) or 1.0)
    _league_scale = {"era": ms([p["era"] for p in rows]),
                     "whip": ms([p["whip"] for p in rows]),
                     "k9": ms([p["k9"] for p in rows])}
    return _league_scale


def _rating(scale, era, whip, k9):
    return (((scale["era"][0] - era) / scale["era"][1])
            + ((scale["whip"][0] - whip) / scale["whip"][1])
            + ((k9 - scale["k9"][0]) / scale["k9"][1])) / 3


async def _team_season(team_id: int, season: int) -> list[dict]:
    if team_id in _sched_cache:
        return _sched_cache[team_id]
    r = await client._http().get(
        f"{client.BASE}/v1/schedule",
        params={"sportId": 1, "teamId": team_id, "gameType": "R",
                "season": season, "startDate": f"{season}-03-01",
                "endDate": f"{season}-11-30"})
    r.raise_for_status()
    rows = []
    for d in (await json_off_loop(r)).get("dates", []):
        for g in d.get("games", []):
            t = g["teams"]
            mine = "home" if t["home"]["team"]["id"] == team_id else "away"
            other = "away" if mine == "home" else "home"
            rows.append({"date": d.get("date"),
                         "final": g["status"]["abstractGameState"] == "Final",
                         "home": mine == "home",
                         "opp_id": t[other]["team"]["id"],
                         "won": bool(t[mine].get("isWinner")),
                         "my_runs": t[mine].get("score"),
                         "opp_runs": t[other].get("score")})
    rows.sort(key=lambda x: x["date"] or "")
    _sched_cache[team_id] = rows
    return rows


def _prior(rows, date):
    return [g for g in rows if g["final"] and (g["date"] or "") < date]


# ---- factor bands (mirror backend/favorite/*) -----------------------------

def _strength(prior_mine, prior_theirs) -> dict:
    def pyth(rows):
        rs = sum(g["my_runs"] or 0 for g in rows)
        ra = sum(g["opp_runs"] or 0 for g in rows)
        return 0.5 if not rs or not ra else rs ** 1.83 / (rs ** 1.83 + ra ** 1.83)
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
        try:
            order = int(p.get("battingOrder"))
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


# ---- price sources --------------------------------------------------------

async def _abbrs() -> dict:
    global _abbr_cache
    if _abbr_cache is None:
        _abbr_cache = await client.team_abbreviations()   # full name -> abbr
    return _abbr_cache


def _slug_forms(abbr: str) -> list[str]:
    return _SLUG_FORMS.get((abbr or "").upper(), [(abbr or "").lower()])


_MAX_TAPE_PAGES = 6


async def _tape_prices(condition_id, home_name, away_name, t5_ts, open_ts):
    """T-5 + day-open prices from the data-api trade tape — the fallback for
    markets older than CLOB's ~2-week settled-history retention (probed
    Aug 14: Aug 1 games have bars, Jul 1 and older return zero, while the
    tape still serves June). No timestamp filter is honored, so page
    newest-first until we cross T-5; a page cap bounds the cost."""
    from backend.polymarket.clob import _http as _clob_http  # shared client
    pre, off = [], 0
    for _ in range(_MAX_TAPE_PAGES):
        r = await _clob_http().get("https://data-api.polymarket.com/trades",
                                   params={"market": condition_id,
                                           "limit": 1000, "offset": off})
        r.raise_for_status()
        rows = await json_off_loop(r)
        if not isinstance(rows, list) or not rows:
            break
        pre.extend(t for t in rows
                   if open_ts <= (t.get("timestamp") or 0) <= t5_ts)
        off += len(rows)
        if rows[-1].get("timestamp", 0) < open_ts:
            break
    else:
        return None                      # never reached T-5 within the cap
    if not pre:
        return None
    pre.sort(key=lambda t: t["timestamp"])
    hn, an = home_name.lower(), away_name.lower()
    t5_prices, day_open = {}, {}
    for t in pre:                        # oldest → newest: last write wins T-5
        name = str(t.get("outcome", "")).lower()
        side = ("home" if name and (name in hn or hn in name)
                else "away" if name and (name in an or an in name) else None)
        if side is None:
            continue
        px = round(float(t["price"]) * 100, 2)
        day_open.setdefault(side, px)
        t5_prices[side] = px
    if not t5_prices:
        return None
    # a one-sided tape still prices both: the complement of the other side
    for side, other in (("home", "away"), ("away", "home")):
        if side not in t5_prices:
            t5_prices[side] = round(100 - t5_prices[other], 2)
    return t5_prices, day_open, "trade_tape"


async def _gamma_prices(away_name, home_name, date, t5_iso):
    """(t5_prices, day_open, source_note) from Polymarket's settled history —
    the no-tick path. None when the event or its prices cannot be found."""
    abbr = await _abbrs()
    event = None
    for a in _slug_forms(abbr.get(away_name, "")):
        for h in _slug_forms(abbr.get(home_name, "")):
            try:
                event = await gamma.lookup_event(f"mlb-{a}-{h}-{date}")
            except Exception:
                event = None
            if event:
                break
        if event:
            break
    if not event:
        return None

    # the moneyline market: its two outcome labels are the team names
    # (lookup_event already normalizes to [{label, token_id}])
    tokens, cond_id = {}, None
    hn, an = home_name.lower(), away_name.lower()
    for m in event.get("markets") or []:
        outs = m.get("outcomes") or []
        if len(outs) != 2:
            continue
        cand = {}
        for o in outs:
            name = str(o.get("label", "")).lower()
            if name and (name in hn or hn in name):
                cand["home"] = o.get("token_id")
            elif name and (name in an or an in name):
                cand["away"] = o.get("token_id")
        if len(cand) == 2 and all(cand.values()):
            tokens, cond_id = cand, m.get("condition_id")
            break
    if len(tokens) != 2:
        return None

    t5_ts = int(datetime.fromisoformat(t5_iso.replace("Z", "+00:00")).timestamp())
    open_ts = int(datetime.fromisoformat(f"{date}T10:00:00+00:00").timestamp())

    # first choice: CLOB 10-min bars (recent settled markets only)
    t5_prices, day_open, ok = {}, {}, True
    for side, tok in tokens.items():
        bars = await clob.fetch_full_price_history(tok, fidelity=10)
        before = [b for b in bars if b[0] <= t5_ts]
        # the last bar at/before T-5; a bar more than an hour old means the
        # history has a hole there — fall through rather than guess
        if not before or t5_ts - before[-1][0] > 3600:
            ok = False
            break
        t5_prices[side] = round(before[-1][1] * 100, 2)
        after_open = [b for b in bars if b[0] >= open_ts]
        day_open[side] = round(after_open[0][1] * 100, 2) if after_open else None
    if ok:
        return t5_prices, day_open, "clob_10min_bars"

    # fallback: the trade tape, which retains the whole season
    if cond_id:
        return await _tape_prices(cond_id, home_name, away_name, t5_ts, open_ts)
    return None


# ---- the build ------------------------------------------------------------

async def _build(g: dict, scale: dict, pen_rank: dict):
    """g: {game_pk, market_id(0=untracked), home_id, away_id, home_name,
    away_name, first_pitch, date, probables{away,home}, home_won,
    home_outcome_id?, away_outcome_id?}"""
    pk = g["game_pk"]
    first_pitch = datetime.fromisoformat(g["first_pitch"].replace("Z", "+00:00"))
    t5 = _iso(first_pitch - timedelta(minutes=T5_MIN))
    date = g["date"]

    if g.get("home_outcome_id"):        # tracked: exact ticks
        t5_prices = {"home": store.tick_price_at(g["home_outcome_id"], t5),
                     "away": store.tick_price_at(g["away_outcome_id"], t5)}
        day_open = {s: store.tick_price_at(g[f"{s}_outcome_id"],
                                           f"{date}T10:00:00Z", max_lag_s=8 * 3600)
                    for s in ("home", "away")}
        price_source = "own_ticks"
    else:                               # untracked: settled CLOB bars
        got = await _gamma_prices(g["away_name"], g["home_name"], date, t5)
        if got:
            t5_prices, day_open, price_source = got
        else:
            t5_prices, day_open, price_source = {"home": None, "away": None}, {}, "none"

    box = None
    for params in ({"timecode": first_pitch.strftime("%Y%m%d_%H%M%S"),
                    "fields": _BOX_FIELDS}, {"fields": _BOX_FIELDS}):
        try:
            r = await client._http().get(f"{client.BASE}/v1/game/{pk}/boxscore",
                                         params=params)
            r.raise_for_status()
            box = (await json_off_loop(r)).get("teams") or {}
            if box:
                break
        except Exception:
            continue
    if not box:
        return
    box_players = [((box.get("away") or {}).get("players") or {}),
                   ((box.get("home") or {}).get("players") or {})]

    season = int(date[:4])
    sched = {s: _prior(await _team_season(g[f"{s}_id"], season), date)
             for s in ("away", "home")}

    sides = {}
    for side in ("away", "home"):
        opp = "home" if side == "away" else "away"
        factors = [
            fav_market.score(t5_prices.get(side), (day_open or {}).get(side)),
            _sp(scale, box_players, (g["probables"] or {}).get(side),
                (g["probables"] or {}).get(opp)),
            _bullpen(pen_rank, g[f"{side}_id"]),
            _strength(sched[side], sched[opp]),
            _rest(sched[side], sched[opp], g[f"{side}_id"], g[f"{opp}_id"],
                  g["home_id"], date),
            _lineup(box.get(side) or {}),
            _form(sched[side]),
            _park(g["home_id"]),
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

    store.save_fav_history(pk, g["market_id"], t5, {
        "game_pk": pk, "favorite": favorite, "synthetic": True,
        "away_name": g["away_name"], "home_name": g["home_name"],
        "game_date": date, "first_pitch": g["first_pitch"],
        "away": sides["away"], "home": sides["home"],
        "t5_prices": t5_prices, "price_source": price_source,
        "home_won": g.get("home_won"),
        "approximations": APPROXIMATIONS,
    })


# ---- pending discovery ----------------------------------------------------

async def _sweep_day(date: str) -> list[dict]:
    """Every Final regular-season game on a date, with everything _build
    needs and no further MLB calls."""
    r = await client._http().get(
        f"{client.BASE}/v1/schedule",
        params={"sportId": 1, "date": date, "gameType": "R",
                "hydrate": "probablePitcher", "fields": _SWEEP_FIELDS})
    r.raise_for_status()
    out = []
    for d in (await json_off_loop(r)).get("dates", []):
        for g in d.get("games", []):
            if g.get("gameType") != "R":
                continue
            if (g.get("status") or {}).get("abstractGameState") != "Final":
                continue
            t = g["teams"]
            hs, as_ = t["home"].get("score"), t["away"].get("score")
            if hs is None or as_ is None:
                continue
            out.append({
                "game_pk": g["gamePk"], "market_id": 0,
                "home_id": t["home"]["team"]["id"],
                "away_id": t["away"]["team"]["id"],
                "home_name": t["home"]["team"]["name"],
                "away_name": t["away"]["team"]["name"],
                "first_pitch": g.get("gameDate"), "date": date,
                "probables": {s: ((t[s].get("probablePitcher") or {}).get("id"))
                              for s in ("away", "home")},
                "home_won": hs > as_,
            })
    return out


async def _pending(limit: int) -> list[dict]:
    """Oldest-first: tracked games missing history (exact prices), then the
    season sweep for everything else."""
    out = []
    for g in store.fav_history_pending(limit):
        # enrich the tracked rows to the _build shape
        from backend.favorite.data import game_info
        info = await game_info(g["game_pk"])
        if not info or not info.get("game_date"):
            continue
        out.append({"game_pk": g["game_pk"], "market_id": g["market_id"],
                    "home_id": info["home_id"], "away_id": info["away_id"],
                    "home_name": info["home_name"], "away_name": info["away_name"],
                    "first_pitch": info["game_date"],
                    "date": (info.get("official_date") or "")[:10],
                    "probables": info.get("probables") or {},
                    "home_won": None,
                    "home_outcome_id": g["home_outcome_id"],
                    "away_outcome_id": g["away_outcome_id"]})
        if len(out) >= limit:
            return out

    with get_db() as conn:
        have = {r["game_pk"] for r in conn.execute(
            "SELECT game_pk FROM backtest_fav_history")}
    day = datetime.strptime(SEASON_START, "%Y-%m-%d").date()
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).date()
    while day <= yesterday and len(out) < limit:
        try:
            for g in await _sweep_day(day.isoformat()):
                if g["game_pk"] not in have and len(out) < limit:
                    out.append(g)
        except Exception as e:
            log.warning("fav history: sweep %s failed: %s", day, e)
        day += timedelta(days=1)
    return out


_status = {"running": False, "last_batch": 0}


async def run_batch(limit: int = 120) -> dict:
    if _status["running"]:
        return {"running": True}
    _status["running"] = True
    try:
        pending = await _pending(limit)
        _status["last_batch"] = len(pending)
        if not pending:
            return {"running": False, "batch": 0}
        log.info("fav history: %d game(s) this pass", len(pending))
        scale = await _league_sd_scale()
        pen_rank = (await league_pitching())["pen_rank"]
        sem = asyncio.Semaphore(CONCURRENCY)

        async def one(g):
            async with sem:
                try:
                    await _build(g, scale, pen_rank)
                except Exception as e:  # noqa: BLE001
                    log.warning("fav history: %s failed: %s", g["game_pk"], e)

        await asyncio.gather(*(one(g) for g in pending))
        return {"running": False, "batch": len(pending)}
    finally:
        _status["running"] = False


def status() -> dict:
    with get_db() as conn:
        done = conn.execute("SELECT COUNT(*) c FROM backtest_fav_history").fetchone()["c"]
        priced = conn.execute(
            "SELECT COUNT(*) c FROM backtest_fav_history "
            "WHERE payload LIKE '%own_ticks%' OR payload LIKE '%clob_10min%' "
            "OR payload LIKE '%trade_tape%'"
        ).fetchone()["c"]
    return {"running": _status["running"], "reconstructed": done,
            "with_price": priced, "last_batch": _status["last_batch"]}
