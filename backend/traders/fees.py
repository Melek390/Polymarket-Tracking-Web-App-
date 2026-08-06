"""Polymarket's published fee schedule and the per-fill fee calculation.

Source: docs.polymarket.com/trading/fees (verified Aug 6, 2026):
    fee = shares x rate x price x (1 - price)   — TAKERS ONLY, makers pay 0.
Their own example reproduces exactly (100 crypto shares @ 50c = $1.75).

Rates live HERE and nowhere else, so a Polymarket fee change is a one-line
edit. Do NOT read the CLOB market's maker_base_fee/taker_base_fee fields —
they contradict the published schedule (see V3.md).
"""

RATES = {
    "crypto": 0.07,
    "sports": 0.05,      # also Economics / Culture / Weather / Other-General
    "politics": 0.04,    # also Finance / Mentions / Tech
    "geopolitics": 0.0,
}

# Keyword buckets for the trades a personal wallet actually makes. Sports and
# Other/General share one rate, so the default is only wrong when a trade is
# really crypto (0.07) or politics/finance (0.04) — those get keywords.
_CRYPTO = ("btc", "eth", "bitcoin", "ethereum", "solana", "crypto", "doge", "xrp")
_POLITICS = ("election", "president", "senate", "congress", "mayor", "primary",
             "nominate", "politic", "fed-", "rate-cut", "cpi", "inflation",
             "gdp", "recession", "tariff")


def rate_for(slug: str, title: str = "") -> float:
    """The fee rate for a market, from its slug/title."""
    text = f"{slug or ''} {title or ''}".lower()
    if any(k in text for k in _CRYPTO):
        return RATES["crypto"]
    if any(k in text for k in _POLITICS):
        return RATES["politics"]
    return RATES["sports"]


def fee_for(role: str, size: float, price: float, rate: float) -> float:
    """The fee one fill paid. price is 0..1; rounded like Polymarket (5 dp)."""
    if role != "taker":
        return 0.0
    return round(size * rate * price * (1.0 - price), 5)
