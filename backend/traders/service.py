"""Glue between the data-api, the store and the engine.

House rules honoured: sync is throttled so browser polling can never fan out
to Polymarket per request, and live positions are cached in-process for a few
seconds (one uvicorn worker, so a module dict IS the cache)."""

import asyncio
import time

from backend.traders import dataapi, engine, fees, store

SYNC_MIN_S = 120     # a wallet is re-synced at most this often
POS_TTL_S = 20       # live positions/value cache

_pos_cache: dict[str, tuple[float, list[dict]]] = {}
_val_cache: dict[str, tuple[float, float | None]] = {}
# condition_id -> (cached_at, resolution|None). A CLOSED resolution is
# immutable, so it caches forever; open/unknown retries after RES_TTL_S.
_res_cache: dict[str, tuple[float, dict | None]] = {}
RES_TTL_S = 600


async def sync_account(acct: dict, force: bool = False) -> int:
    """Pull new fills for a wallet into the store. Returns fills added."""
    if not force and acct.get("last_sync"):
        synced = time.mktime(time.strptime(acct["last_sync"], "%Y-%m-%dT%H:%M:%SZ"))
        if time.time() - synced < SYNC_MIN_S:
            return 0
    fills = await dataapi.fetch_fills(acct["wallet"])
    for f in fills:
        f["fee"] = fees.fee_for(f["role"], f["size"], f["price"],
                                fees.rate_for(f["event_slug"], f["title"]))
    added = store.insert_fills(acct["id"], fills)
    store.touch_sync(acct["id"])
    return added


async def _positions(wallet: str) -> list[dict]:
    hit = _pos_cache.get(wallet)
    if hit and time.monotonic() - hit[0] < POS_TTL_S:
        return hit[1]
    rows = await dataapi.fetch_positions(wallet)
    _pos_cache[wallet] = (time.monotonic(), rows)
    return rows


async def _value(wallet: str) -> float | None:
    """Portfolio value, or None if /value is having a moment — it is the
    flakiest data-api endpoint (hung from the VM while /trades answered in
    0.2s) and must never take the whole summary down with it."""
    hit = _val_cache.get(wallet)
    if hit and time.monotonic() - hit[0] < POS_TTL_S:
        return hit[1]
    try:
        v = await dataapi.fetch_value(wallet)
    except Exception:
        v = None
    _val_cache[wallet] = (time.monotonic(), v)
    return v


def _redeems_as_sells(activity: list[dict]) -> list[dict]:
    """REDEEM events become $1 exits with no fee (winner held to the end).
    Missing them makes every held winner look like an open position forever.

    GOTCHA (found reconciling against a real profile, Aug 6): REDEEM rows
    carry an EMPTY `asset` — redemption happens at the condition level — so
    they are keyed by (conditionId, outcome) and resolved to the bought token
    in matched(). Zero-size redeems (the losing side being cleaned up) are
    skipped: they close nothing and rendered as "Redeemed 0"."""
    out = []
    for a in activity:
        if a.get("type") != "REDEEM" or float(a.get("size") or 0) <= 0:
            continue
        out.append({
            "tx": a.get("transactionHash") or "", "asset": a.get("asset") or "",
            "condition_id": a.get("conditionId") or "", "title": a.get("title") or "",
            "slug": a.get("slug") or "", "event_slug": a.get("eventSlug") or "",
            "outcome": a.get("outcome") or "", "side": "SELL",
            "price": 1.0, "size": float(a.get("size") or 0),
            "ts": int(a.get("timestamp") or 0), "role": "maker", "fee": 0.0,
        })
    return out


async def _resolve_many(condition_ids: set[str]) -> dict[str, dict | None]:
    """CLOB resolutions with a forever-cache for closed markets and bounded
    concurrency — the first pass over an account can need hundreds."""
    now = time.monotonic()
    todo = [c for c in condition_ids
            if c not in _res_cache
            or (not (_res_cache[c][1] and _res_cache[c][1]["closed"])
                and now - _res_cache[c][0] > RES_TTL_S)]
    if todo:
        sem = asyncio.Semaphore(8)

        async def one(cid):
            async with sem:
                try:
                    _res_cache[cid] = (time.monotonic(), await dataapi.fetch_resolution(cid))
                except Exception:
                    _res_cache[cid] = (time.monotonic(), None)
        await asyncio.gather(*(one(c) for c in todo))
    return {c: _res_cache.get(c, (0, None))[1] for c in condition_ids}


async def matched(acct: dict) -> tuple[list[dict], dict[str, dict], list[dict]]:
    """(closed trips, open trips, live position rows) for one account."""
    positions = await _positions(acct["wallet"])
    # a holding still listed but priced at zero is a resolved loss
    resolutions = {p["asset"]: 0.0 for p in positions
                   if float(p.get("curPrice") or 0) == 0}
    redeems = _redeems_as_sells(await dataapi.fetch_activity(acct["wallet"], 500))
    stored = store.fills_for(acct["id"])
    # resolve each redeem's empty asset to the token that was actually bought
    by_market = {(f["condition_id"], f["outcome"]): f["asset"]
                 for f in stored if f["side"] == "BUY"}
    for r in redeems:
        r["asset"] = r["asset"] or by_market.get((r["condition_id"], r["outcome"]), "")
    redeems = [r for r in redeems if r["asset"]]  # unmatchable without a buy
    fills = sorted(stored + redeems, key=lambda f: (f["ts"], f.get("id", 0)))
    closed, open_trips = engine.match(fills, resolutions)

    # GHOSTS: net-long trips whose asset Polymarket no longer lists at all.
    # Resolved-lost holdings are dropped from /positions after a while, which
    # silently hid every ride-to-zero loss (454 on the client's test account).
    # The CLOB's winner flags say how those markets actually ended.
    pos_assets = {p["asset"] for p in positions}
    ghosts = {a: t for a, t in open_trips.items()
              if a not in pos_assets and t["buy_qty"] - t["sell_qty"] > engine.EPS}
    if ghosts:
        infos = await _resolve_many({t["condition_id"] for t in ghosts.values()})
        extra = {}
        for a, t in ghosts.items():
            info = infos.get(t["condition_id"])
            if info and info["closed"]:
                won = info["winners"].get((t["outcome"] or "").lower())
                if won is not None:
                    extra[a] = 1.0 if won else 0.0
        if extra:
            closed, open_trips = engine.match(fills, {**resolutions, **extra})
    return closed, open_trips, positions


async def summary(acct: dict) -> dict:
    closed, _open_trips, positions = await matched(acct)
    unrealized = sum(float(p.get("cashPnl") or 0) for p in positions)
    realized = sum(c["net"] for c in closed)
    wins = sum(1 for c in closed if c["win"])
    holds = [c["hold_s"] for c in closed]
    value = await _value(acct["wallet"])
    if value is None:  # fall back to the positions we already have
        value = round(sum(float(p.get("currentValue") or 0) for p in positions), 2)
    return {
        "portfolio_value": value,
        "unrealized_pnl": round(unrealized, 2),
        "realized_pnl": round(realized, 2),
        "total_pnl": round(realized + unrealized, 2),
        "fees_paid": round(sum(c["fees"] for c in closed), 2),
        "win_rate": wins / len(closed) if closed else None,
        "wins": wins,
        "closed_count": len(closed),
        "open_count": len(positions),
        "avg_hold_s": sum(holds) // len(holds) if holds else None,
    }


async def open_rows(acct: dict) -> list[dict]:
    """Open positions straight from /positions (live prices), plus our tags."""
    _closed, _trips, positions = await matched(acct)
    tags = store.tags_for(acct["id"])
    rows = []
    for p in positions:
        rows.append({
            "asset": p.get("asset"),
            "title": p.get("title"),
            "outcome": p.get("outcome"),
            "event_slug": p.get("eventSlug") or "",
            "avg_price": float(p.get("avgPrice") or 0),
            "cur_price": float(p.get("curPrice") or 0),
            "shares": float(p.get("size") or 0),
            "cost": float(p.get("initialValue") or 0),
            "value": float(p.get("currentValue") or 0),
            "pnl": float(p.get("cashPnl") or 0),
            "pct_pnl": float(p.get("percentPnl") or 0),
            "redeemable": bool(p.get("redeemable")),
            "tags": tags.get(p.get("asset"), []),
        })
    rows.sort(key=lambda r: -r["value"])
    return rows


async def closed_rows(acct: dict) -> list[dict]:
    closed, _trips, _positions = await matched(acct)
    tags = store.tags_for(acct["id"])
    for c in closed:
        c["tags"] = tags.get(c["asset"], [])
    return closed


async def activity_rows(acct: dict) -> list[dict]:
    acts = await dataapi.fetch_activity(acct["wallet"], 500)  # the API's max page
    # zero-size redeems are the worthless side being cleaned up — noise
    acts = [a for a in acts
            if not (a.get("type") == "REDEEM" and float(a.get("size") or 0) <= 0)]
    return [{
        "ts": int(a.get("timestamp") or 0),
        "type": a.get("type"),
        "side": a.get("side"),
        "title": a.get("title"),
        "outcome": a.get("outcome"),
        "size": float(a.get("size") or 0),
        "price": float(a.get("price") or 0),
    } for a in acts]
