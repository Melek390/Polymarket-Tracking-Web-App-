"""MLB replay + tick alignment — how a recorded game becomes backtest spots.

THE ALIGNMENT, in one sentence: MLB's play-by-play stamps every play with
about.endTime in UTC, our ticks table stamps every price in UTC, and both
clocks are the same clock — so "the price when the half-inning ended" is a
plain indexed lookup of the first tick at/after that timestamp, and the
factor snapshot at that moment comes from MLB's own ?timecode= replay of the
boxscore/linescore (verified back to the oldest corpus game, May 9).

What this module computes per game:
  halves()    ordered half-inning ends with scores, from ONE filtered
              playByPlay (~7 KB via the fields trick, never /feed/live)
  due-up      each side's batter rotation read off the play sequence itself
  factors()   pitch counts / walks / season ERA-WHIP for both current
              pitchers (timecode boxscore) + trailing team's hits so far
              (timecode linescore) — factors 4 (team form) and 9 (price vs
              history) are stored as NULL = honestly unknown in v1, never 0
  ticks       entry mid at +0/15/30/60 s and the path summary: for k=1..6
              future half-ends, the max mid in between and the mid at each
              boundary — the compressed shape every win definition and delay
              model replays from
"""

import asyncio
import statistics
from datetime import datetime, timedelta, timezone

from backend.database.db import get_db
from backend.favorite.data import STADIUMS, game_info
from backend.mlb import client

DELAYS = (0, 15, 30, 60)
PATH_HALVES = 6
WIDE_NET_CENTS = 45.0   # store anything under this; run-time gates narrow
MAX_DEFICIT_STORED = 6

_PBP_FIELDS = ("allPlays,about,endTime,halfInning,inning,result,awayScore,"
               "homeScore,matchup,batter,id")
_BOX_FIELDS = ("teams,away,home,pitchers,players,person,id,stats,pitching,"
               "numberOfPitches,pitchesThrown,baseOnBalls,seasonStats,era,whip")


def _ts(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _timecode(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y%m%d_%H%M%S")


async def halves(game_pk: int) -> list[dict]:
    """Ordered completed half-innings: [{ts, inning, half, away, home,
    next_half, due_up_index}]. due_up_index = 1-based lineup slot of the
    batter the OTHER side (about to bat) sends up next, read from that side's
    own appearance order — no boxscore needed."""
    r = await client._http().get(
        f"{client.BASE}/v1/game/{game_pk}/playByPlay",
        params={"fields": _PBP_FIELDS})
    r.raise_for_status()
    plays = r.json().get("allPlays", [])
    if not plays:
        return []

    order: dict[str, list[int]] = {"top": [], "bottom": []}   # batter ids, in appearance order
    last_batter: dict[str, int | None] = {"top": None, "bottom": None}
    out, cur_key = [], None
    for p in plays:
        about = p.get("about") or {}
        half = (about.get("halfInning") or "").lower()
        inning = about.get("inning")
        end = about.get("endTime")
        if not half or not inning or not end:
            continue
        batter = ((p.get("matchup") or {}).get("batter") or {}).get("id")
        if batter:
            if batter not in order[half]:
                order[half].append(batter)
            last_batter[half] = batter
        res = p.get("result") or {}
        key = (inning, half)
        if key != cur_key and cur_key is not None:
            pass  # boundary emitted below, on the LAST play of each half
        cur_key = key
        # overwrite-in-place: the half's entry always reflects its final play
        if out and out[-1]["_key"] == key:
            out[-1].update(ts=end, away=res.get("awayScore"), home=res.get("homeScore"))
        else:
            out.append({"_key": key, "inning": inning, "half": half, "ts": end,
                        "away": res.get("awayScore"), "home": res.get("homeScore")})

    # attach what follows each half + the due-up slot for the side coming in.
    # The lineup is that side's first nine distinct batters in appearance
    # order; a pinch hitter (10th+ face) makes the slot honestly unknown.
    for h in out:
        h["next_half"] = "bottom" if h["half"] == "top" else "top"
        lineup = order[h["next_half"]][:9]
        last = last_batter_at(plays, h["ts"], h["next_half"])
        if last is None and not lineup:
            h["due_up_index"] = 1          # side has not batted yet: top of the order
        elif last in lineup:
            h["due_up_index"] = (lineup.index(last) + 1) % 9 + 1
        else:
            h["due_up_index"] = None       # pinch hitter — slot unknown
        h.pop("_key", None)
    return out


def last_batter_at(plays: list[dict], ts: str, half: str) -> int | None:
    """The last batter that side used at or before ts."""
    last = None
    for p in plays:
        about = p.get("about") or {}
        if (about.get("halfInning") or "").lower() != half:
            continue
        end = about.get("endTime")
        if not end or end > ts:
            continue
        last = ((p.get("matchup") or {}).get("batter") or {}).get("id") or last
    return last


async def pitcher_snapshot(game_pk: int, at: datetime) -> dict:
    """Both CURRENT pitchers at a moment, via the timecode boxscore:
    {side: {pitches, walks_game, era, whip}}. Missing pieces stay None."""
    r = await client._http().get(
        f"{client.BASE}/v1/game/{game_pk}/boxscore",
        params={"timecode": _timecode(at), "fields": _BOX_FIELDS})
    r.raise_for_status()
    teams = r.json().get("teams", {})
    out = {}
    for side in ("away", "home"):
        t = teams.get(side) or {}
        pitchers = t.get("pitchers") or []
        pid = pitchers[-1] if pitchers else None
        info = {"pitcher_id": pid, "pitches": None, "walks_game": None,
                "era": None, "whip": None}
        player = (t.get("players") or {}).get(f"ID{pid}") if pid else None
        if player:
            g = (player.get("stats") or {}).get("pitching") or {}
            info["pitches"] = g.get("numberOfPitches") or g.get("pitchesThrown")
            info["walks_game"] = g.get("baseOnBalls")
            s = (player.get("seasonStats") or {}).get("pitching") or {}
            try:
                info["era"] = float(s["era"]) if s.get("era") else None
            except (TypeError, ValueError):
                info["era"] = None
            try:
                info["whip"] = float(s["whip"]) if s.get("whip") else None
            except (TypeError, ValueError):
                info["whip"] = None
        out[side] = info
    return out


async def hits_at(game_pk: int, at: datetime) -> dict:
    """{away, home} hit totals at a moment (timecode linescore, ~1 KB)."""
    r = await client._http().get(
        f"{client.BASE}/v1/game/{game_pk}/linescore",
        params={"timecode": _timecode(at), "fields": "teams,away,home,hits"})
    r.raise_for_status()
    t = r.json().get("teams", {})
    return {"away": (t.get("away") or {}).get("hits"),
            "home": (t.get("home") or {}).get("hits")}


# ---- tick lookups ---------------------------------------------------------

def tick_at(conn, outcome_id: int, ts: str) -> float | None:
    """First stored mid at/after ts (falls back to the last one before it —
    a boundary can outlive a market that stopped ticking at game end)."""
    row = conn.execute(
        "SELECT price FROM ticks WHERE outcome_id=? AND ts>=? ORDER BY ts LIMIT 1",
        (outcome_id, ts)).fetchone()
    if row:
        return row["price"]
    row = conn.execute(
        "SELECT price FROM ticks WHERE outcome_id=? AND ts<? ORDER BY ts DESC LIMIT 1",
        (outcome_id, ts)).fetchone()
    return row["price"] if row else None


def max_between(conn, outcome_id: int, t0: str, t1: str) -> float | None:
    row = conn.execute(
        "SELECT MAX(price) AS m FROM ticks WHERE outcome_id=? AND ts>? AND ts<=?",
        (outcome_id, t0, t1)).fetchone()
    return row["m"]


def tick_span(conn, outcome_id: int) -> tuple[str | None, str | None]:
    row = conn.execute(
        "SELECT MIN(ts) a, MAX(ts) b FROM ticks WHERE outcome_id=?",
        (outcome_id,)).fetchone()
    return row["a"], row["b"]


def median_gap_seconds(conn, outcome_id: int, t0: str, t1: str) -> float | None:
    """Median spacing of this outcome's ticks across the live window — the
    gold/silver split. Counts alone lie (the Aug 6 lesson); spacing doesn't."""
    rows = conn.execute(
        "SELECT ts FROM ticks WHERE outcome_id=? AND ts>=? AND ts<=? "
        "ORDER BY ts LIMIT 20000", (outcome_id, t0, t1)).fetchall()
    if len(rows) < 10:
        return None
    stamps = [_ts(r["ts"]).timestamp() for r in rows]
    gaps = [b - a for a, b in zip(stamps, stamps[1:]) if b > a]
    return statistics.median(gaps) if gaps else None


# ---- factor banding at run time lives in engine.py; here we only store RAW.

async def build_spots(market_id: int, game_pk: int, gold: int,
                      outcome_ids: dict, mlb_names: dict) -> list[dict]:
    """All qualifying spots for one game. outcome_ids/mlb_names: {side: ...}."""
    hs = await halves(game_pk)
    if not hs:
        return []
    info = await game_info(game_pk)
    park = STADIUMS.get((info or {}).get("home_id") or 0)
    park_factor = park[2] if park else None

    spots = []
    with get_db() as conn:
        for i, h in enumerate(hs[:-1]):          # after the game's final half there is no trade
            away_runs, home_runs = h.get("away"), h.get("home")
            if away_runs is None or home_runs is None or away_runs == home_runs:
                continue
            trailing = "home" if home_runs < away_runs else "away"
            deficit = abs(away_runs - home_runs)
            if deficit > MAX_DEFICIT_STORED:
                continue
            oid = outcome_ids[trailing]
            e0 = tick_at(conn, oid, h["ts"])
            if e0 is None or e0 > WIDE_NET_CENTS or e0 < 0.5:
                continue

            at = _ts(h["ts"])
            entries = {f"entry{d}": tick_at(conn, oid, _iso(at + timedelta(seconds=d)))
                       for d in DELAYS}

            # the compressed price path: k future half-ends
            path = {}
            future = hs[i + 1: i + 1 + PATH_HALVES]
            for k, fh in enumerate(future, start=1):
                path[str(k)] = {
                    "ts": fh["ts"],
                    "max": max_between(conn, oid, h["ts"], fh["ts"]),
                    "at": tick_at(conn, oid, fh["ts"]),
                }

            # remaining regulation offense for the trailing side
            innings_left = (9 - h["inning"]) + (1 if h["next_half"] == "top" else 0)
            halves_left = sum(
                1 for inn in range(h["inning"], 10)
                for half in (("top", "bottom") if inn > h["inning"]
                             else (("bottom",) if h["next_half"] == "bottom" else ("top", "bottom")))
                if (half == "top") == (trailing == "away"))

            try:
                pitchers = await pitcher_snapshot(game_pk, at)
                hits = await hits_at(game_pk, at)
            except Exception:
                pitchers, hits = {}, {}

            leading = "home" if trailing == "away" else "away"
            factors = {
                # 1-3 come from the spot columns; the rest are raw inputs
                "lead_pitcher": pitchers.get(leading),
                "trail_pitcher": pitchers.get(trailing),
                "due_up_index": h.get("due_up_index"),
                "park_factor": park_factor,
                "weather": None,            # v1: not replayed
                "team_form": None,          # v1: honestly unknown (needs per-date records)
                "we_edge": None,            # v1: honestly unknown (needs the WE table)
                "trail_hits": (hits or {}).get(trailing),
            }
            spots.append({
                "market_id": market_id, "game_pk": game_pk, "gold": gold,
                "ts": h["ts"], "inning": h["inning"], "next_half": h["next_half"],
                "trailing_side": trailing,
                "trailing_is_home": 1 if trailing == "home" else 0,
                "deficit": deficit, "innings_left": innings_left,
                "halves_left": halves_left, **entries,
                "factors": factors, "path": path,
            })
    return spots
