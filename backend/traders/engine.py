"""Round-trip matching: SELLs against BUYs per asset, weighted-average cost.

The client's settled rules (V3.md):
- WIN  = the round trip netted > $0 AFTER fees. Lost money = loss.
- FEES are in every number.
- A REDEEM is an exit at $1 (winner held to resolution), fee 0.
- A resolved residual closes at its final price: 0 = rode to zero (a loss),
  1 = an old winner redeemed beyond the activity window (a win). Resolution
  comes from /positions (curPrice 0) and, for holdings Polymarket has already
  dropped from /positions, from the CLOB's winner flags.
"""

EPS = 0.01  # shares: below this a position counts as fully exited


def _new_trip(f: dict) -> dict:
    return {
        "asset": f["asset"], "title": f["title"], "slug": f["slug"],
        "event_slug": f["event_slug"], "outcome": f["outcome"],
        "condition_id": f["condition_id"],
        "open_ts": f["ts"], "last_ts": f["ts"],
        "buy_qty": 0.0, "buy_cost": 0.0, "sell_qty": 0.0, "proceeds": 0.0,
        "fees": 0.0, "buys": 0, "sells": 0,
        "first_buy": None, "min_buy": None,
    }


def _close(trip: dict, reason: str) -> dict:
    net = trip["proceeds"] - trip["buy_cost"] - trip["fees"]
    return {
        "asset": trip["asset"], "title": trip["title"], "slug": trip["slug"],
        "event_slug": trip["event_slug"], "outcome": trip["outcome"],
        # carried through so a row can be tracked/charted in one click
        "condition_id": trip["condition_id"],
        "opened_ts": trip["open_ts"], "closed_ts": trip["last_ts"],
        "shares": round(trip["buy_qty"], 2),
        "avg_buy": trip["buy_cost"] / trip["buy_qty"] if trip["buy_qty"] else 0.0,
        "avg_sell": trip["proceeds"] / trip["sell_qty"] if trip["sell_qty"] else 0.0,
        "cost": round(trip["buy_cost"], 2),
        "proceeds": round(trip["proceeds"], 2),
        "fees": round(trip["fees"], 2),
        "net": round(net, 2),
        "win": net > 0,
        "hold_s": max(0, trip["last_ts"] - trip["open_ts"]),
        "averaged_down": trip["buys"] > 1 and trip["min_buy"] is not None
                         and trip["first_buy"] is not None
                         and trip["min_buy"] < trip["first_buy"],
        "close_reason": reason,  # sold | resolved_zero
    }


def match(fills: list[dict], resolutions: dict[str, float]) -> tuple[list[dict], dict[str, dict]]:
    """(closed round trips, still-open trips by asset).

    fills must be in time order. resolutions maps asset -> final price for
    markets known to be resolved; residual shares close at that price.
    A SELL with no open trip (bought beyond the API's 10k window) is skipped —
    we can't price a cost basis we never saw.
    """
    open_trips: dict[str, dict] = {}
    closed: list[dict] = []

    for f in fills:
        trip = open_trips.get(f["asset"])
        if f["side"] == "BUY":
            if trip is None:
                trip = open_trips[f["asset"]] = _new_trip(f)
            trip["buy_qty"] += f["size"]
            trip["buy_cost"] += f["size"] * f["price"]
            trip["fees"] += f["fee"]
            trip["buys"] += 1
            trip["last_ts"] = f["ts"]
            if trip["first_buy"] is None:
                trip["first_buy"] = f["price"]
            trip["min_buy"] = f["price"] if trip["min_buy"] is None else min(trip["min_buy"], f["price"])
        else:  # SELL (a REDEEM arrives here as a synthetic SELL at 1.0, fee 0)
            if trip is None:
                continue
            trip["sell_qty"] += f["size"]
            trip["proceeds"] += f["size"] * f["price"]
            trip["fees"] += f["fee"]
            trip["sells"] += 1
            trip["last_ts"] = f["ts"]
            if trip["buy_qty"] - trip["sell_qty"] <= EPS:
                closed.append(_close(trip, "sold"))
                del open_trips[f["asset"]]

    # residuals on resolved markets close at the final price
    for asset in [a for a in open_trips if a in resolutions]:
        trip = open_trips.pop(asset)
        final = resolutions[asset]
        left = trip["buy_qty"] - trip["sell_qty"]
        if left > 0:
            trip["proceeds"] += left * final
            trip["sell_qty"] += left
        closed.append(_close(trip, "resolved_zero" if final <= 0 else "resolved_won"))

    closed.sort(key=lambda c: -c["closed_ts"])
    return closed, open_trips
