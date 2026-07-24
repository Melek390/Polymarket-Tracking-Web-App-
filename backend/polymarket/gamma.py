"""Gamma API client — event discovery, used only when adding or screening markets."""

import json
import logging

import httpx

from backend.config.settings import settings

log = logging.getLogger(__name__)


def parse_slug(url_or_slug: str) -> str:
    """Pull a clean slug out of whatever the user pasted — full URL, slug or id."""
    text = url_or_slug.strip().split("?")[0].rstrip("/")
    if "/" in text:
        text = text.split("/")[-1]
    return text


def infer_kind(labels: list[str]) -> str:
    """Guess the market type (yes_no / totals / wdl / team) from its outcome labels."""
    lower = [label.lower() for label in labels]
    if set(lower) == {"yes", "no"}:
        return "yes_no"
    if any(label.startswith(("over", "under")) for label in lower):
        return "totals"
    if len(lower) == 3 and "draw" in lower:
        return "wdl"
    return "team"


def _json_list(value) -> list:
    """Decode Gamma's JSON-strings-inside-JSON quirk without ever crashing."""
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return []
    return value or []


async def fetch_events_by_tag(tag_id: int, pages: int = 3) -> list[dict]:
    """Active events for one sport tag, paging until the list runs out."""
    events = []
    async with httpx.AsyncClient(timeout=settings.http_timeout) as client:
        for offset in range(0, pages * 100, 100):
            r = await client.get(
                f"{settings.gamma_base_url}/events",
                params={
                    "tag_id": tag_id,
                    "active": "true",
                    "closed": "false",
                    "limit": 100,
                    "offset": offset,
                },
            )
            # Gamma refuses offsets past its ceiling (~2100) with a 422;
            # that just means we have reached the end of the list
            if r.status_code == 422:
                return events
            r.raise_for_status()
            batch = r.json()
            events += batch
            if len(batch) < 100:
                return events
    # ran out of pages before Polymarket ran out of events: say so loudly,
    # because silently truncating means matches go missing from the screener
    log.warning(
        "tag %s has more than %d events; raise the page limit", tag_id, len(events)
    )
    return events


async def lookup_event(url_or_slug: str) -> dict | None:
    """Fetch an event and its markets from Gamma; None when nothing matches."""
    slug = parse_slug(url_or_slug)
    params = {"id": slug} if slug.isdigit() else {"slug": slug}

    async with httpx.AsyncClient(timeout=settings.http_timeout) as client:
        r = await client.get(f"{settings.gamma_base_url}/events", params=params)
        r.raise_for_status()

    events = r.json()
    if not events:
        return None
    event = events[0]

    markets = []
    for m in event.get("markets", []):
        labels = _json_list(m.get("outcomes"))
        token_ids = _json_list(m.get("clobTokenIds"))
        if not labels or len(labels) != len(token_ids):
            continue
        markets.append(
            {
                "condition_id": m["conditionId"],
                "question": m.get("question") or m.get("groupItemTitle", ""),
                "kind": infer_kind(labels),
                "outcomes": [
                    {"label": label, "token_id": token}
                    for label, token in zip(labels, token_ids)
                ],
            }
        )

    return {"slug": event["slug"], "title": event["title"], "markets": markets}
