"""Gamma API client — event discovery, used only when adding or screening markets."""

import json
import logging

import httpx

from backend.config.settings import settings

log = logging.getLogger(__name__)

# Shared client — a fresh AsyncClient per call rebuilds the SSL context (loads
# the CA bundle from disk, blocking the loop). Reuse one.
_client: httpx.AsyncClient | None = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=settings.http_timeout)
    return _client


def parse_slug(url_or_slug: str) -> str:
    """Pull a clean slug out of whatever the user pasted — full URL, slug or id."""
    text = url_or_slug.strip().split("?")[0].rstrip("/")
    if "/" in text:
        text = text.split("/")[-1]
    return text


# Tags every event carries, so they say nothing about what it is
_GENERIC_TAGS = {"sports", "games", "all", "hide from new", "recurring",
                 "trending", "breaking news", "up or down"}
# The badge shown on the tracker, most specific first ("MLB" beats "baseball",
# "Crypto" beats "Bitcoin") so a prop is easy to find by category.
_CATEGORIES = [
    "MLB", "NBA", "NFL", "NHL", "NCAA", "MLS", "EPL", "UFC", "F1",
    "Soccer", "Tennis", "Cricket", "Esports", "Golf", "MMA", "Boxing",
    "Basketball", "Baseball", "Football", "Hockey", "Rugby",
    "Politics", "Elections", "Geopolitics", "Middle East", "Ukraine",
    "Crypto", "Bitcoin", "Ethereum", "Finance", "Economics", "Business",
    "Tech", "AI", "Science", "Weather", "Pop Culture", "Awards", "Mentions",
]


def category_of(event: dict) -> str:
    """A short category for an event ("MLB", "Soccer", "Politics", "Crypto"),
    taken from its Gamma tags."""
    labels = [t.get("label", "") for t in (event.get("tags") or []) if t.get("label")]
    lower = {label.lower() for label in labels}
    for category in _CATEGORIES:
        if category.lower() in lower:
            return category
    # nothing recognised — fall back to the most specific meaningful tag
    for label in reversed(labels):
        if label.lower() not in _GENERIC_TAGS:
            return label
    return "Other"


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
    client = _http()
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

    r = await _http().get(f"{settings.gamma_base_url}/events", params=params)
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

    return {
        "slug": event["slug"],
        "title": event["title"],
        "category": category_of(event),
        "markets": markets,
    }
