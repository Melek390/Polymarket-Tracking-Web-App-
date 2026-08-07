"""Read-only client for Polymarket's public data-api (no key needed).

One shared httpx client per module — never one per call, that was the
July 27 event-loop stall (see V2.md)."""

import httpx

BASE = "https://data-api.polymarket.com"
CLOB = "https://clob.polymarket.com"
TIMEOUT = 15.0
PAGE = 500
MAX_OFFSET = 10_000  # hard server cap: offset=20000 -> HTTP 400

_client: httpx.AsyncClient | None = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=TIMEOUT)
    return _client


async def _paged(path: str, params: dict) -> list[dict]:
    out: list[dict] = []
    offset = 0
    while offset < MAX_OFFSET:
        r = await _http().get(f"{BASE}{path}",
                              params={**params, "limit": PAGE, "offset": offset})
        r.raise_for_status()
        batch = r.json()
        if not isinstance(batch, list) or not batch:
            break
        out += batch
        if len(batch) < PAGE:
            break
        offset += PAGE
    return out


def _fill_key(t: dict) -> tuple:
    return (t.get("transactionHash"), t.get("asset"), t.get("side"),
            t.get("price"), t.get("size"))


def _norm(t: dict, role: str) -> dict:
    return {
        "tx": t.get("transactionHash") or "",
        "asset": t.get("asset") or "",
        "condition_id": t.get("conditionId") or "",
        "title": t.get("title") or "",
        "slug": t.get("slug") or "",
        "event_slug": t.get("eventSlug") or "",
        "outcome": t.get("outcome") or "",
        "side": t.get("side") or "",
        "price": float(t.get("price") or 0),
        "size": float(t.get("size") or 0),
        "ts": int(t.get("timestamp") or 0),
        "role": role,
    }


async def fetch_fills(wallet: str) -> list[dict]:
    """Every fill for a wallet, with its maker/taker role attached.

    /trades defaults to the TAKER side only; takerOnly=false returns all
    fills. A fill absent from the taker feed was made as a MAKER (fee $0) —
    verified Aug 6, see V3.md. An ambiguous duplicate lands as taker, so fees
    are never understated. Classification must happen at ingest: the feeds
    only reach back 10k rows.
    """
    taker = await _paged("/trades", {"user": wallet})
    every = await _paged("/trades", {"user": wallet, "takerOnly": "false"})
    taker_keys = {_fill_key(t) for t in taker}
    fills = [_norm(t, "taker" if _fill_key(t) in taker_keys else "maker")
             for t in every]
    # near the 10k cap the merged feed can miss rows the taker feed still has
    seen = {_fill_key(t) for t in every}
    fills += [_norm(t, "taker") for t in taker if _fill_key(t) not in seen]
    return fills


async def fetch_fill_fees(wallet: str) -> dict[tuple, float]:
    """The EXACT fee per fill, from the activity feed: usdcSize is the USDC
    that actually moved, price*size is the face amount, and the difference is
    the fee (buyers pay extra, sellers receive less; makers diff to zero).

    Found Aug 7 reconciling the client's account: the flat schedule cannot be
    trusted across time — Polymarket raised sports taker fees 3% -> 5% in
    mid-2026, and our computed rate overcharged every older fill by 2/3."""
    rows = await _paged("/activity", {"user": wallet, "type": "TRADE"})
    out: dict[tuple, float] = {}
    for r in rows:
        price = float(r.get("price") or 0)
        size = float(r.get("size") or 0)
        diff = float(r.get("usdcSize") or 0) - price * size
        fee = diff if r.get("side") == "BUY" else -diff
        key = (r.get("transactionHash"), r.get("side"), round(price, 6), round(size, 4))
        out[key] = out.get(key, 0.0) + fee
    # clamp float dust so maker fills store a clean zero
    return {k: (v if v > 1e-4 else 0.0) for k, v in out.items()}


async def fetch_positions(wallet: str) -> list[dict]:
    """Current holdings (winners pending redeem and dead losers included)."""
    return await _paged("/positions", {"user": wallet, "sizeThreshold": 0})


async def fetch_activity(wallet: str, limit: int = 60) -> list[dict]:
    r = await _http().get(f"{BASE}/activity", params={"user": wallet, "limit": limit})
    r.raise_for_status()
    return r.json() if isinstance(r.json(), list) else []


async def fetch_value(wallet: str) -> float | None:
    # /value is the flakiest endpoint here and it's merely cosmetic (summary
    # falls back to summing positions) — never let it hold a page for 15s
    r = await _http().get(f"{BASE}/value", params={"user": wallet}, timeout=3.0)
    r.raise_for_status()
    d = r.json()
    if isinstance(d, list) and d:
        return float(d[0].get("value") or 0)
    return None


async def fetch_resolution(condition_id: str) -> dict | None:
    """How a market resolved, from the CLOB: closed flag + per-outcome winner.

    This is the source of truth for positions that VANISH from /positions —
    Polymarket drops resolved-lost holdings from the public API after a while,
    which made ride-to-zero losses look like forever-open positions (found on
    the client's own testing account: 454 of them)."""
    r = await _http().get(f"{CLOB}/markets/{condition_id}")
    if r.status_code != 200:
        return None
    m = r.json()
    return {
        "closed": bool(m.get("closed")),
        "winners": {str(t.get("outcome") or "").lower(): bool(t.get("winner"))
                    for t in m.get("tokens", [])},
    }


async def fetch_price_history(token_id: str) -> list[dict]:
    """Full price history for a CLOB token: [{"t": epoch_s, "p": 0..1}, ...].
    interval=max is the only form that works for settled markets (V2.md) —
    resolution is ~1-min bars for the last day, ~10-min beyond."""
    r = await _http().get(f"{CLOB}/prices-history",
                          params={"market": token_id, "interval": "max", "fidelity": 1})
    if r.status_code != 200:
        return []
    return r.json().get("history", []) or []
