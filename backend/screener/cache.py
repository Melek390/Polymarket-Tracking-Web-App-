"""Builds the screener cache: fetches a sport's events from Gamma and turns
each match into one row with home / draw / away prices."""

import json
import logging
import re
from datetime import datetime, timedelta, timezone

from backend.database import db
from backend.mlb import client as mlb
from backend.polymarket import gamma
from backend.polymarket.gamma import _json_list

log = logging.getLogger(__name__)

# Soccer is 3-way (home/draw/away); every other sport here is a 2-way
# moneyline with no draw. Baseball is intentionally left out (the UI shows a
# disabled button for it).
SPORT_TAGS = {
    "soccer": 100350,
    "basketball": 28,
    "baseball": 100381,  # MLB — enriched with live game state
    "tennis": 864,
    "football": 450,     # NFL
    "cricket": 517,
    "esports": 64,
}
THREE_WAY = {"soccer"}

# tags that describe every event; whatever remains is the league name
GENERIC_TAGS = {
    "Sports", "Games", "All", "Hide From New", "Recurring", "Trending",
    "Breaking News", "Soccer", "Basketball", "Tennis", "Football", "NFL",
    "Cricket", "Esports",
}


def _league_of(event: dict) -> str:
    """The most specific tag label on the event, or Other."""
    for tag in reversed(event.get("tags", [])):
        name = tag.get("label", "")
        if name and name not in GENERIC_TAGS:
            return name
    return "Other"


def _iso_utc(raw: str | None) -> str | None:
    """Normalize Gamma's date strings to our 2026-07-23T17:00:00Z format."""
    if not raw:
        return None
    try:
        d = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return None


def _ask_cents(market: dict) -> float | None:
    """Best ask (buy price) in cents — the number Polymarket's Games view
    shows, so the screener matches their UI. None when nothing is offered."""
    ask = market.get("bestAsk")
    if ask is None:
        return None
    return round(float(ask) * 100, 2)


def _teams(text: str) -> tuple[str, str] | None:
    """Split 'Home vs. Away' into the two names, or None if not a match."""
    home, _, away = text.partition(" vs")
    home = home.strip()
    away = away.lstrip(".").strip()
    if not home or not away or home == away:
        return None
    return home, away


def _clean_name(name: str) -> str:
    """Drop trailing '(BO3)' / ' - League' noise from a team name."""
    return re.split(r"\s+-\s+|\s+\(", name)[0].strip() or name


def parse_title(title: str) -> tuple[str | None, str, str] | None:
    """(competition, home, away) from an event title. Tennis, cricket and
    esports use a 'Tournament: A vs B' shape, so the prefix becomes the league
    and the names come out clean; soccer/NFL have no prefix."""
    competition = None
    body = title
    prefix, sep, rest = title.partition(":")
    if sep and " vs" in rest.lower():
        competition = prefix.strip()
        body = rest
    teams = _teams(body)
    if not teams:
        return None
    home, away = _clean_name(teams[0]), _clean_name(teams[1])
    if not home or not away or home == away:
        return None
    return competition, home, away


def _yes_token(market: dict) -> str | None:
    """The CLOB token id of a market's Yes outcome, for live pricing."""
    labels = _json_list(market.get("outcomes"))
    toks = _json_list(market.get("clobTokenIds"))
    for label, tok in zip(labels, toks):
        if label.lower() == "yes":
            return tok
    return None


def _soccer_prices(event: dict, home: str, away: str):
    """Home/draw/away asks from the three win/draw yes-no markets, plus each
    market's Yes token id (ordered home, draw, away) for live pricing."""
    prices = {"home": None, "draw": None, "away": None}
    tokens = {"home": None, "draw": None, "away": None}
    for m in event.get("markets", []):
        q = (m.get("question") or "").lower()
        if "draw" in q:
            prices["draw"], tokens["draw"] = _ask_cents(m), _yes_token(m)
        elif q.startswith("will") and home.lower() in q:
            prices["home"], tokens["home"] = _ask_cents(m), _yes_token(m)
        elif q.startswith("will") and away.lower() in q:
            prices["away"], tokens["away"] = _ask_cents(m), _yes_token(m)
    return prices, [tokens["home"], tokens["draw"], tokens["away"]]


_NON_MONEYLINE = ("spread", "o/u", "handicap", "total", "game ", "set ",
                  "half", "score", "over/under")


def _two_way_prices(event: dict):
    """Home/away asks from the single moneyline market (no draw), plus its
    [home, away] CLOB token ids. Away is the binary complement of the home
    bid, exactly as Polymarket derives it. The moneyline is the first market
    whose two outcomes are the team names."""
    prices = {"home": None, "draw": None, "away": None}
    tokens = []
    for m in event.get("markets", []):
        q = (m.get("question") or "").lower()
        outs = _json_list(m.get("outcomes"))
        if len(outs) != 2 or outs[0].lower() in ("yes", "over", "under", "no"):
            continue
        if any(word in q for word in _NON_MONEYLINE):
            continue
        ask, bid = m.get("bestAsk"), m.get("bestBid")
        if ask is not None:
            prices["home"] = round(float(ask) * 100, 2)
        if bid is not None:
            prices["away"] = round((1 - float(bid)) * 100, 2)
        tokens = _json_list(m.get("clobTokenIds"))
        break
    return prices, tokens


def extract_match(event: dict, sport: str, now_iso: str) -> dict | None:
    """One Gamma event -> one screener row, or None when it is not a match."""
    title = event.get("title", "")
    # skip "- More Markets" twins, which repeat a match's spreads/totals
    if "more markets" in title.lower():
        return None
    parsed = parse_title(title)
    if not parsed:
        return None
    competition, home, away = parsed

    if sport in THREE_WAY:
        prices, tokens = _soccer_prices(event, home, away)
    else:
        prices, tokens = _two_way_prices(event)
    if prices["home"] is None and prices["away"] is None:
        return None  # no winner market we could read, nothing to show

    # kickoff comes from any market's gameStartTime
    kickoff = None
    for m in event.get("markets", []):
        kickoff = _iso_utc(m.get("gameStartTime"))
        if kickoff:
            break
    kickoff = kickoff or _iso_utc(event.get("startDate"))

    # Gamma keeps some long-finished games flagged active; drop anything
    # whose kickoff is more than a day in the past
    if kickoff:
        now = datetime.fromisoformat(now_iso.replace("Z", "+00:00"))
        started = datetime.fromisoformat(kickoff.replace("Z", "+00:00"))
        if (now - started).days >= 1:
            return None

    condition_ids = [m["conditionId"] for m in event.get("markets", []) if m.get("conditionId")]
    return {
        "event_slug": event["slug"],
        "sport": sport,
        "league": competition or _league_of(event),
        "home_team": home,
        "away_team": away,
        "kickoff": kickoff,
        "volume": round(float(event.get("volume") or 0)),
        "home_price": prices["home"],
        "draw_price": prices["draw"],
        "away_price": prices["away"],
        "condition_ids": json.dumps(condition_ids),
        "game_pk": None,  # filled in for baseball from the MLB schedule
        "token_ids": json.dumps(tokens),  # [home, away] for live CLOB pricing
        "updated_at": now_iso,
    }


async def _attach_game_pks(rows: list[dict]):
    """Match each baseball row to its MLB gamePk by team names and date. A
    late game's UTC date can be one ahead of its US game date, so we also try
    the day before."""
    schedules: dict[str, dict] = {}

    async def by_pair(date: str) -> dict:
        if date not in schedules:
            try:
                games = await mlb.schedule(date)
                schedules[date] = {
                    frozenset({g["away"].lower(), g["home"].lower()}): g["game_pk"]
                    for g in games
                }
            except Exception as e:
                log.warning("MLB schedule %s failed: %s", date, e)
                schedules[date] = {}
        return schedules[date]

    for r in rows:
        if not r["kickoff"]:
            continue
        d = datetime.fromisoformat(r["kickoff"].replace("Z", "+00:00"))
        pair = frozenset({r["home_team"].lower(), r["away_team"].lower()})
        for cand in (d.date(), (d - timedelta(days=1)).date()):
            pk = (await by_pair(cand.isoformat())).get(pair)
            if pk:
                r["game_pk"] = pk
                break


async def refresh(sport: str):
    """Fetch one sport's events and rebuild its screener cache."""
    # 50 pages is far above the ~2k events Polymarket lists for a sport;
    # the fetch stops as soon as the list runs out
    events = await gamma.fetch_events_by_tag(SPORT_TAGS[sport], pages=50)
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    rows = [r for e in events if (r := extract_match(e, sport, now_iso))]
    if sport == "baseball":
        await _attach_game_pks(rows)
    db.replace_screener_cache(sport, rows)
    log.info("screener cache: %s -> %d matches from %d events",
             sport, len(rows), len(events))


async def refresh_all():
    """Rebuild the cache for every supported sport, one after another."""
    for sport in SPORT_TAGS:
        try:
            await refresh(sport)
        except Exception as e:
            log.warning("screener refresh failed for %s: %s", sport, e)
