"""Builds the screener cache: fetches a sport's events from Gamma and turns
each match into one row with home / draw / away prices."""

import json
import logging
from datetime import datetime, timezone

from backend.database import db
from backend.polymarket import gamma
from backend.polymarket.gamma import _json_list

log = logging.getLogger(__name__)

SPORT_TAGS = {"soccer": 100350}  # more sports come after client approval

# tags that describe every event; whatever remains is the league name
GENERIC_TAGS = {
    "Sports", "Games", "Soccer", "All", "Hide From New",
    "Recurring", "Trending", "Breaking News",
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


def _yes_price_cents(market: dict) -> float | None:
    """The Yes outcome's price in cents, for the win/draw yes-no markets."""
    labels = _json_list(market.get("outcomes"))
    prices = _json_list(market.get("outcomePrices"))
    for label, price in zip(labels, prices):
        if label.lower() == "yes":
            return round(float(price) * 100, 2)
    return None


def extract_match(event: dict, sport: str, now_iso: str) -> dict | None:
    """One Gamma event -> one screener row, or None when it is not a match."""
    title = event.get("title", "")
    lower = title.lower()
    # skip non-matches (award markets etc.) and "- More Markets" twins,
    # which hold the spreads/totals for a match already listed once
    if " vs" not in lower or "more markets" in lower:
        return None
    home, _, away = title.partition(" vs")
    home = home.strip()
    away = away.lstrip(".").strip()
    if not home or not away or home == away:
        return None

    home_price = draw_price = away_price = kickoff = None
    condition_ids = []
    for m in event.get("markets", []):
        q = (m.get("question") or "").lower()
        kickoff = kickoff or _iso_utc(m.get("gameStartTime"))
        if "draw" in q:
            draw_price = _yes_price_cents(m)
        elif q.startswith("will") and home.lower() in q:
            home_price = _yes_price_cents(m)
        elif q.startswith("will") and away.lower() in q:
            away_price = _yes_price_cents(m)
        else:
            continue
        if m.get("conditionId"):
            condition_ids.append(m["conditionId"])

    if home_price is None and away_price is None:
        return None  # no winner markets at all, nothing to show

    # Gamma keeps some long-finished games flagged active; drop anything
    # whose kickoff is more than a day in the past
    if kickoff:
        now = datetime.fromisoformat(now_iso.replace("Z", "+00:00"))
        started = datetime.fromisoformat(kickoff.replace("Z", "+00:00"))
        if (now - started).days >= 1:
            return None

    return {
        "event_slug": event["slug"],
        "sport": sport,
        "league": _league_of(event),
        "home_team": home,
        "away_team": away,
        "kickoff": kickoff or _iso_utc(event.get("startDate")),
        "volume": round(float(event.get("volume") or 0)),
        "home_price": home_price,
        "draw_price": draw_price,
        "away_price": away_price,
        "condition_ids": json.dumps(condition_ids),
        "updated_at": now_iso,
    }


async def refresh(sport: str = "soccer"):
    """Fetch the sport's events and rebuild its screener cache."""
    # 50 pages is far above the ~2k events Polymarket lists for a sport;
    # the fetch stops as soon as the list runs out
    events = await gamma.fetch_events_by_tag(SPORT_TAGS[sport], pages=50)
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    rows = []
    for event in events:
        row = extract_match(event, sport, now_iso)
        if row:
            rows.append(row)
    db.replace_screener_cache(sport, rows)
    log.info("screener cache: %s -> %d matches from %d events",
             sport, len(rows), len(events))
