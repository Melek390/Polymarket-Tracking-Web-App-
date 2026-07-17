"""CLOB API client — batched midpoint prices, the polling loop's only call."""

import asyncio
import random

import httpx

from backend.config.settings import settings


async def fetch_midpoints(token_ids: list[str]) -> dict[str, float]:
    """Fetch prices for all tokens in one batched call, backing off on errors; raises after max_retries."""
    body = [{"token_id": t} for t in token_ids]
    last_error = None

    for attempt in range(settings.max_retries):
        if attempt:
            await asyncio.sleep(min(30, 2**attempt) + random.random())
        try:
            async with httpx.AsyncClient(timeout=settings.http_timeout) as client:
                r = await client.post(f"{settings.clob_base_url}/midpoints", json=body)
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


async def fetch_price_history(
    token_id: str, start_ts: int, end_ts: int, fidelity: int = 1
) -> list[tuple[int, float]]:
    """One window of a token's price history at 1-minute resolution; [(unix_ts, price), ...]."""
    params = {
        "market": token_id,
        "startTs": start_ts,
        "endTs": end_ts,
        "fidelity": fidelity,
    }
    async with httpx.AsyncClient(timeout=settings.http_timeout) as client:
        r = await client.get(f"{settings.clob_base_url}/prices-history", params=params)
    if r.status_code == 400:  # window predates the market — nothing there
        return []
    r.raise_for_status()
    return [(p["t"], float(p["p"])) for p in r.json().get("history", [])]
