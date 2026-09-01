"""Football draw-at-60 study — the client's brief, 2025, seven clubs.

The question: when one of these teams was LEVEL at the 60th minute, how
often did they go on to win — and what did Polymarket charge for their win
at that moment?

Two sources, joined per game:
  * API-FOOTBALL - finished 2025 fixtures (seasons 2024+2025 filtered to the
    calendar year) and the goal timeline that gives the score at 60'.
  * Polymarket Gamma/CLOB - the game event (two slug generations: the old
    "serie-a-juventus-vs-inter-milan-2-16" style and the new
    "sea-juv-int-2025-09-13" style), its team-win market, and the 1-minute
    price history.

The 60th minute of PLAY happens ~75 minutes after kickoff on the wall clock
(15' half-time break), so the price is sampled in the kickoff+70..+82 window,
nearest kickoff+75. Regulation result only: goals with elapsed <= 90 — the
new-style Polymarket moneylines settle on regulation, and a cup game that
went to extra time counts as the draw it was at 90.

Research CLI, not wired into the app:  python -m backend.backtest.football
Every upstream pull is cached in CACHE (delete it for a clean re-poll), so
reruns after a timeout or tweak cost nothing.
"""
import json
import os
import re
import time
import unicodedata
from datetime import datetime, timedelta, timezone

import httpx

from backend.config.settings import settings

CACHE = "/tmp/football_backtest_cache.json"
RESULTS = "/tmp/football_backtest_results.json"

# api-football team ids, in the client's own wording
TEAMS = {
    42: "Arsenal", 50: "Man City", 497: "Roma", 505: "Inter Milan",
    541: "Real Madrid", 529: "Barcelona", 157: "Bayern Munich",
}
# tag slugs that carry the seven clubs' games, both generations
GAMMA_TAGS = ["epl", "la-liga", "serie-a", "bundesliga", "champions-league",
              "ucl", "uel", "europa-league", "fifa-club-world-cup", "fa-cup",
              "copa-del-rey", "dfb-pokal", "sea", "clf", "itc"]

ALIASES = {
    "man city": "manchester city", "inter milan": "inter", "inter": "inter",
    "bayern munich": "bayern munchen", "as roma": "roma",
    "barca": "barcelona", "fc barcelona": "barcelona",
    "psg": "paris saint germain", "man united": "manchester united",
    "man utd": "manchester united", "spurs": "tottenham",
    "atletico": "atletico madrid", "leverkusen": "bayer leverkusen",
}
_NOISE = re.compile(r"\b(fc|cf|afc|ac|as|ss|ssc|sc|sv|vfb|vfl|tsg|rc|rcd|cd|cp|calcio|club)\b")
_FULL_DATE = re.compile(r"(\d{4}-\d{2}-\d{2})$")
_PART_DATE = re.compile(r"-(\d{1,2})-(\d{1,2})$")


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9 ]", " ", s.lower())
    return re.sub(r"\s+", " ", _NOISE.sub(" ", s)).strip()


def same_team(a: str, b: str) -> bool:
    a, b = norm(a), norm(b)
    a, b = ALIASES.get(a, a), ALIASES.get(b, b)
    return a == b or (len(a) > 3 and a in b) or (len(b) > 3 and b in a)


def _daynum(d: str) -> int:
    return int(d[:4]) * 372 + int(d[5:7]) * 31 + int(d[8:10])


def _load_cache() -> dict:
    try:
        return json.load(open(CACHE))
    except Exception:  # noqa: BLE001 — a missing/corrupt cache just re-polls
        return {}


def _save_cache(c: dict):
    json.dump(c, open(CACHE, "w"))


# ---------------------------------------------------------------- fixtures
def fetch_fixtures(cache: dict) -> dict:
    """Finished calendar-2025 fixtures per club, all competitions."""
    if "fixtures" in cache:
        return cache["fixtures"]
    fb = httpx.Client(base_url="https://v3.football.api-sports.io",
                      headers={"x-apisports-key": settings.football_api_key},
                      timeout=30)
    out = {}
    for tid, tname in TEAMS.items():
        rows = []
        for season in (2024, 2025):
            r = fb.get("/fixtures", params={"team": tid, "season": season})
            r.raise_for_status()
            for f in r.json().get("response", []):
                fx, lg = f.get("fixture") or {}, f.get("league") or {}
                te, goals = f.get("teams") or {}, f.get("goals") or {}
                date = (fx.get("date") or "")[:10]
                if not date.startswith("2025"):
                    continue
                if (fx.get("status") or {}).get("short") not in ("FT", "AET", "PEN"):
                    continue
                rows.append({
                    "fixture_id": fx.get("id"), "date": date, "utc": fx.get("date"),
                    "home": (te.get("home") or {}).get("name"),
                    "away": (te.get("away") or {}).get("name"),
                    "league": lg.get("name"),
                    "gh": goals.get("home"), "ga": goals.get("away"),
                })
            time.sleep(1.2)
        out[tname] = rows
        print("  fixtures %-14s %d" % (tname, len(rows)))
    cache["fixtures"] = out
    _save_cache(cache)
    return out


# ------------------------------------------------------------ poly events
def fetch_poly_events(cache: dict) -> list:
    """Every closed 2025 event under the soccer tags, both slug styles."""
    if "events" in cache:
        return cache["events"]
    g = httpx.Client(base_url="https://gamma-api.polymarket.com", timeout=30)
    events = {}
    for slug in GAMMA_TAGS:
        r = g.get("/tags/slug/" + slug)
        if r.status_code != 200 or not r.json().get("id"):
            continue
        tid, off = int(r.json()["id"]), 0
        while True:
            r2 = g.get("/events", params={
                "tag_id": tid, "closed": "true", "limit": 100, "offset": off,
                "start_date_min": "2025-01-01T00:00:00Z",
                "start_date_max": "2026-01-08T00:00:00Z"})
            if r2.status_code != 200 or not r2.json():
                break
            for e in r2.json():
                events.setdefault(e.get("slug"), {
                    "slug": e.get("slug"), "title": e.get("title"),
                    "start": e.get("startDate")})
            off += 100
            if off > 4000:
                break
            time.sleep(0.15)
    out = list(events.values())
    print("  polymarket closed soccer events:", len(out))
    cache["events"] = out
    _save_cache(cache)
    return out


def _prep(e: dict):
    """Attach matchday + title sides, once per event."""
    slug, t = e.get("slug") or "", e.get("title") or ""
    m = _FULL_DATE.search(slug)
    e["gday"], e["md"] = (m.group(1) if m else None), None
    if not e["gday"]:
        m2 = _PART_DATE.search(slug)
        if m2 and 1 <= int(m2.group(1)) <= 12 and 1 <= int(m2.group(2)) <= 31:
            e["md"] = (int(m2.group(1)), int(m2.group(2)))
    body = re.sub(r"\(.*?\)", "", t.split(":", 1)[-1])
    p = re.split(r"\s+vs\.?\s+", body, flags=re.I)
    e["sides"] = (p[0].strip(), p[1].strip()) if len(p) == 2 else None
    e["advance"] = "advance" in slug or "advance" in t.lower()


def match_events(fixtures: dict, events: list) -> dict:
    """fixture -> polymarket event. Tier 1: full date in the slug (+/-1d).
    Tier 2: old-style month-day suffix (+/-2d). Tier 3: dateless slug,
    nearest listing date within 30d. Plain moneyline beats 'to advance'."""
    for e in events:
        _prep(e)
    ranked = sorted(events, key=lambda e: (
        0 if e["gday"] else (1 if e["md"] else 2), 1 if e["advance"] else 0))
    out = {}
    for tname, rows in fixtures.items():
        hit = []
        for fx in rows:
            fd, best = _daynum(fx["date"]), None
            for e in ranked:
                if not e["sides"]:
                    continue
                a, b = e["sides"]
                fwd = same_team(a, fx["home"]) and same_team(b, fx["away"])
                rev = same_team(a, fx["away"]) and same_team(b, fx["home"])
                if not (fwd or rev):
                    continue
                if e["gday"]:
                    if abs(_daynum(e["gday"]) - fd) <= 1:
                        best = e
                        break
                elif e["md"]:
                    if abs(_daynum("2025-%02d-%02d" % e["md"]) - fd) <= 2:
                        best = e
                        break
                else:
                    sd = (e["start"] or "")[:10]
                    if sd and abs(_daynum(sd) - fd) <= 30:
                        best = best or e
            if best:
                # which title side is the club we are studying
                mine = best["sides"][0] if same_team(best["sides"][0], tname) or \
                    (same_team(best["sides"][0], fx["home"]) and same_team(fx["home"], tname)) or \
                    (same_team(best["sides"][0], fx["away"]) and same_team(fx["away"], tname)) \
                    else best["sides"][1]
                hit.append({**fx, "poly_slug": best["slug"], "poly_team": mine,
                            "advance": best["advance"]})
        out[tname] = hit
        print("  matched %-14s %d of %d" % (tname, len(hit), len(rows)))
    return out


# ------------------------------------------------------------- the score
def score_at_60(cache: dict, fixture_id: int, fb: httpx.Client):
    """(home,away) goals at minute 60 and at 90 (regulation), from the goal
    timeline. None when api-football has no events for the fixture."""
    key = "tl:%d" % fixture_id
    if key not in cache:
        r = fb.get("/fixtures/events", params={"fixture": fixture_id})
        r.raise_for_status()
        cache[key] = [
            {"min": (ev.get("time") or {}).get("elapsed"),
             "team_id": (ev.get("team") or {}).get("id"),
             "type": ev.get("type"), "detail": ev.get("detail")}
            for ev in r.json().get("response", [])]
        _save_cache(cache)
        time.sleep(0.35)
    evs = cache[key]
    if not evs:
        return None
    goals = [e for e in evs if e["type"] == "Goal"
             and e["detail"] != "Missed Penalty" and e["min"] is not None]
    return goals


def tally(goals, home_id, upto):
    h = sum(1 for g in goals if g["team_id"] == home_id and g["min"] <= upto)
    a = sum(1 for g in goals if g["team_id"] != home_id and g["min"] <= upto)
    return h, a


# ------------------------------------------------------------- the price
def _taker_fee(price_cents: float, shares: float) -> float:
    """Same sports-fee formula as engine.py — shares x 5% x p(1-p)."""
    p = price_cents / 100.0
    return shares * 0.05 * p * (1 - p)


def price_at_minute(cache: dict, slug: str, team_title: str, kickoff_iso: str,
                    minute: int, g: httpx.Client, clob: httpx.Client):
    """The club's WIN price at a given minute of PLAY, in cents. Wall clock =
    kickoff + minute (+15' half-time once past the break)."""
    offset = minute + (15 if minute > 45 else 0)
    key = "px%d:%s:%s" % (minute, slug, norm(team_title))
    if key in cache:
        return cache[key]
    out = None
    try:
        r = g.get("/events", params={"slug": slug})
        ev = (r.json() or [None])[0] if r.status_code == 200 else None
        token = None
        for m in (ev or {}).get("markets", []):
            label = " ".join(str(m.get(k) or "") for k in
                             ("question", "groupItemTitle"))
            if "draw" in label.lower():
                continue
            outcomes = json.loads(m.get("outcomes") or "[]")
            tokens = json.loads(m.get("clobTokenIds") or "[]")
            if not tokens:
                continue
            if same_team(label, team_title) or any(
                    same_team(o, team_title) for o in outcomes):
                if outcomes and outcomes[0] not in ("Yes", "No"):
                    for i, o in enumerate(outcomes):
                        if same_team(o, team_title) and i < len(tokens):
                            token = tokens[i]
                            break
                else:
                    token = tokens[0]          # the YES side
            if token:
                break
        if token:
            k = datetime.fromisoformat(kickoff_iso.replace("Z", "+00:00"))
            lo = int((k + timedelta(minutes=offset - 7)).timestamp())
            hi = int((k + timedelta(minutes=offset + 7)).timestamp())
            r2 = clob.get("/prices-history", params={
                "market": token, "startTs": lo, "endTs": hi, "fidelity": 1})
            hist = (r2.json() or {}).get("history") or []
            want = (k + timedelta(minutes=offset)).timestamp()
            if hist:
                p = min(hist, key=lambda x: abs(x["t"] - want))
                out = round(float(p["p"]) * 100, 1)
            time.sleep(0.2)
    except Exception:  # noqa: BLE001 — a game without history just has no price
        out = None
    cache[key] = out
    _save_cache(cache)
    return out


# ------------------------------------------------------------------ main
MINUTES = [30, 45, 60, 70, 75, 80]   # the Adjust-settings choices in the UI


def run_minute(minute: int, matched: dict, cache: dict, fb, g, clob) -> dict:
    """One pass: every matched game LEVEL at `minute`, its regulation result,
    the club's win price at that moment, and P&L with and without fees
    ($100 flat, taker fee on the buy leg — settlement pays none)."""
    team_ids = {v: k for k, v in TEAMS.items()}
    teams = {}
    for tname, rows in matched.items():
        tid = team_ids[tname]
        det = []
        for fx in rows:
            goals = score_at_60(cache, fx["fixture_id"], fb)
            if goals is None:
                continue
            at_home = same_team(fx["home"], tname)
            mine = sum(1 for x in goals if x["min"] <= minute and x["team_id"] == tid)
            opp = sum(1 for x in goals if x["min"] <= minute and x["team_id"] != tid)
            if mine != opp:
                continue                         # not level at that minute
            mine90 = sum(1 for x in goals if x["min"] <= 90 and x["team_id"] == tid)
            opp90 = sum(1 for x in goals if x["min"] <= 90 and x["team_id"] != tid)
            res = "W" if mine90 > opp90 else ("D" if mine90 == opp90 else "L")
            px = None
            if not fx["advance"]:
                px = price_at_minute(cache, fx["poly_slug"], fx["poly_team"],
                                     fx["utc"], minute, g, clob)
            det.append({
                "date": fx["date"], "opp": fx["away"] if at_home else fx["home"],
                "ha": "H" if at_home else "A", "league": fx["league"],
                "scoreAt": "%d-%d" % (mine, opp), "result90": res,
                "priceAt": px, "slug": fx["poly_slug"],
            })
        pnl = fees = 0.0
        priced = [d for d in det if d["priceAt"] is not None]
        for d in priced:
            px = d["priceAt"]
            shares = 100.0 / (px / 100.0)
            fee = _taker_fee(px, shares)
            fees += fee
            pnl += shares * (100 - px) / 100.0 if d["result90"] == "W" else -100.0
        teams[tname] = {
            "backtestable": len(rows),
            "draws": len(det),
            "won": sum(1 for d in det if d["result90"] == "W"),
            "drew": sum(1 for d in det if d["result90"] == "D"),
            "lost": sum(1 for d in det if d["result90"] == "L"),
            "win_rate": round(100.0 * sum(1 for d in det if d["result90"] == "W")
                              / len(det), 1) if det else None,
            "priced": len(priced),
            "avg_price": round(sum(d["priceAt"] for d in priced) / len(priced), 1)
            if priced else None,
            "pnl100": round(pnl, 2),
            "pnl100_fees": round(pnl - fees, 2),
            "games": det,
        }
    s = {k: sum(t[k] for t in teams.values())
         for k in ("draws", "won", "drew", "lost", "priced")}
    px_sum = sum((t["avg_price"] or 0) * t["priced"] for t in teams.values())
    summary = {
        **s,
        "win_rate": round(100.0 * s["won"] / s["draws"], 1) if s["draws"] else None,
        "avg_price": round(px_sum / s["priced"], 1) if s["priced"] else None,
        "pnl100": round(sum(t["pnl100"] for t in teams.values()), 2),
        "pnl100_fees": round(sum(t["pnl100_fees"] for t in teams.values()), 2),
    }
    print("  minute %2d: draws %3d -> W %d / D %d / L %d  avg px %s  "
          "pnl %+0.0f (%+0.0f after fees)" % (
              minute, s["draws"], s["won"], s["drew"], s["lost"],
              summary["avg_price"], summary["pnl100"], summary["pnl100_fees"]))
    return {"summary": summary, "teams": teams}


def run():
    cache = _load_cache()
    print("[1/4] fixtures (api-football)")
    fixtures = fetch_fixtures(cache)
    print("[2/4] polymarket events")
    events = fetch_poly_events(cache)
    print("[3/4] matching")
    matched = match_events(fixtures, events)

    fb = httpx.Client(base_url="https://v3.football.api-sports.io",
                      headers={"x-apisports-key": settings.football_api_key},
                      timeout=30)
    g = httpx.Client(base_url="https://gamma-api.polymarket.com", timeout=30)
    clob = httpx.Client(base_url="https://clob.polymarket.com", timeout=30)

    print("[4/4] level-at-minute scans")
    by_minute = {str(m): run_minute(m, matched, cache, fb, g, clob)
                 for m in MINUTES}
    out = {
        "meta": {
            "name": "Draw at 60' — 2025",
            "year": 2025, "clubs": len(TEAMS),
            "fixtures_2025": sum(len(r) for r in fixtures.values()),
            "available_both_apis": sum(len(r) for r in matched.values()),
            "minutes": MINUTES, "default_minute": 60,
            "computed_at": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "note": ("Regulation result only (90'). Price = the club's win "
                     "price at the chosen minute of play (wall clock adds the "
                     "15' half-time past 45'), CLOB 1-minute history. P&L = "
                     "$100 flat per priced game; the after-fees column charges "
                     "Polymarket's sports taker fee on the buy leg."),
        },
        "byMinute": by_minute,
    }
    json.dump(out, open(RESULTS, "w"), indent=1)
    print("\nresults ->", RESULTS)
    return out


if __name__ == "__main__":
    run()
