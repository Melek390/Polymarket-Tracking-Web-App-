"""Market screener — searches live Polymarket markets with queries like
'soccer, o/u 3.5, over < 0.40' (sport, prop text, price condition)."""

import re

from backend.polymarket import gamma
from backend.polymarket.gamma import _json_list, infer_kind

# Gamma tag ids, harvested from live events (July 2026)
SPORT_TAGS = {
    "soccer": 100350,
    "football": 100350,
    "tennis": 864,
    "baseball": 678,
    "mlb": 100381,
    "basketball": 28,
    "nba": 745,
    "nfl": 450,
    "cricket": 517,
    "esports": 64,
}

PRICE_RE = re.compile(r"^(.*?)\s*([<>])\s*(\d*\.?\d+)$")


def parse_query(query: str) -> dict | None:
    """Split 'sport, prop text, side < value' into filters; None if the sport is unknown."""
    parts = [p.strip() for p in query.split(",") if p.strip()]
    if not parts:
        return None
    tag_id = SPORT_TAGS.get(parts[0].lower())
    if not tag_id:
        return None

    filters = {"tag_id": tag_id, "text": "", "side": "", "op": "", "value": 0.0}
    for part in parts[1:]:
        m = PRICE_RE.match(part)
        if m:
            filters["side"] = m.group(1).strip().lower()
            filters["op"] = m.group(2)
            # accept both "over < 0.40" (fraction) and "over < 40" (cents)
            value = float(m.group(3))
            filters["value"] = value * 100 if value <= 1 else value
        else:
            filters["text"] = part.lower()
    return filters


def _price_matches(labels, prices, side, op, value):
    """True when any outcome (or the named side) satisfies the < / > condition."""
    for lab, price in zip(labels, prices):
        if side and side not in lab.lower():
            continue
        if (op == "<" and price < value) or (op == ">" and price > value):
            return True
    return False


async def screen(query: str, max_results: int = 50) -> list[dict] | None:
    """Run a screener query against live Gamma data; None means unknown sport."""
    f = parse_query(query)
    if f is None:
        return None

    events = await gamma.fetch_events_by_tag(f["tag_id"])
    results = []
    for e in events:
        for m in e.get("markets", []):
            question = m.get("question") or m.get("groupItemTitle", "")
            if f["text"] and f["text"] not in question.lower():
                continue
            labels = _json_list(m.get("outcomes"))
            tokens = _json_list(m.get("clobTokenIds"))
            prices = [
                round(float(p) * 100, 2) for p in _json_list(m.get("outcomePrices"))
            ]
            if not labels or len(labels) != len(tokens) or len(labels) != len(prices):
                continue
            if f["op"] and not _price_matches(labels, prices, f["side"], f["op"], f["value"]):
                continue
            results.append(
                {
                    "event_slug": e["slug"],
                    "event_title": e["title"],
                    "condition_id": m["conditionId"],
                    "question": question,
                    "kind": infer_kind(labels),
                    "outcomes": [
                        {"label": lab, "token_id": tok, "price": price}
                        for lab, tok, price in zip(labels, tokens, prices)
                    ],
                }
            )
            if len(results) >= max_results:
                return results
    return results
