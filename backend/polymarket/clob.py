"""CLOB API client — batched midpoint prices, the polling loop's only call."""

import asyncio
import random

import httpx

from backend.config.settings import settings

# Shared client — a new httpx.AsyncClient per call rebuilds the SSL context
# (ssl.create_default_context() loads the whole CA bundle from disk, blocking
# the event loop). Reuse one client for its SSL context + keep-alive pool.
_client: httpx.AsyncClient | None = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=settings.http_timeout)
    return _client


async def fetch_midpoints(token_ids: list[str]) -> dict[str, float]:
    """Fetch prices for all tokens in one batched call, backing off on errors; raises after max_retries."""
    body = [{"token_id": t} for t in token_ids]
    last_error = None

    for attempt in range(settings.max_retries):
        if attempt:
            await asyncio.sleep(min(30, 2**attempt) + random.random())
        try:
            r = await _http().post(f"{settings.clob_base_url}/midpoints", json=body)
            if r.status_code == 429:
                last_error = "HTTP 429"
                continue
            r.raise_for_status()
            return {t: float(p) for t, p in r.json().items()}
        except (httpx.HTTPError, ValueError) as e:
            last_error = e

    raise RuntimeError(
        f"midpoints failed after {settings.max_retries} attempts: {last_error}"
    )


async def fetch_mid_prices(token_ids: list[str]) -> dict[str, float | None]:
    """Midpoint price in CENTS per token — the probability Polymarket shows on
    a market (mid of best bid/ask). One batched /midpoints call. Missing or
    resolved tokens map to None; never raises (safe for the live poller)."""
    if not token_ids:
        return {}
    body = [{"token_id": t} for t in token_ids]
    try:
        r = await _http().post(f"{settings.clob_base_url}/midpoints", json=body)
        r.raise_for_status()
        data = r.json()
    except (httpx.HTTPError, ValueError):
        return {t: None for t in token_ids}
    out = {}
    for t in token_ids:
        v = data.get(t)
        try:
            out[t] = round(float(v) * 100, 2) if v is not None else None
        except (TypeError, ValueError):
            out[t] = None
    return out




async def fetch_full_price_history(token_id: str, fidelity: int = 1) -> list[tuple[int, float]]:
    """A token's entire available history in one call.

    `interval=max` serves history even for markets that resolved before we
    started tracking them — the startTs/endTs form returns nothing for those,
    which used to leave late-tracked markets with no history at all."""
    params = {"market": token_id, "interval": "max", "fidelity": fidelity}
    r = await _http().get(f"{settings.clob_base_url}/prices-history", params=params)
    if r.status_code == 400:  # token unknown to the history service
        return []
    r.raise_for_status()
    return [(p["t"], float(p["p"])) for p in r.json().get("history", [])]


