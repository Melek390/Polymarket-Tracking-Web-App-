"""Factor 1 — Market probability + line movement (max 28).

The Polymarket price IS the implied probability (59c = 59%), vig left in per
the client's spec. Movement is measured against today's opening price."""

MAX = 28


def score(price: float | None, opened: float | None) -> dict:
    if price is None:
        return {"key": "market", "points": 0, "max": MAX, "ok": False,
                "detail": "no market price"}
    if price >= 66.7:
        base = 24
    elif price >= 63.0:
        base = 18
    elif price >= 59.0:
        base = 12
    else:
        base = 0
    move = (price - opened) if opened is not None else 0.0
    bonus = 4 if move >= 3.0 else 2 if move >= 1.5 else 0
    detail = f"price {price:.1f}¢"
    if opened is not None:
        detail += f", open {opened:.1f}¢ ({move:+.1f}pp)"
    return {"key": "market", "points": min(MAX, base + bonus), "max": MAX,
            "ok": True, "below_59": price < 59.0, "detail": detail}
