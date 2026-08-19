"""Request bodies for the REST API."""

from pydantic import BaseModel, Field


class LookupRequest(BaseModel):
    url_or_slug: str


class TrackRequest(BaseModel):
    slug: str
    market_condition_ids: list[str]


class TrackChartRequest(BaseModel):
    """One-click "Dashboard": track a market and open its chart. condition_id
    names the exact market (a position on the accounts page); without it the
    match's own winner market is picked (a screener row)."""

    slug: str
    condition_id: str | None = None


class MarketPatch(BaseModel):
    poll_interval: int = Field(ge=1, le=3600)


class ScreenerRequest(BaseModel):
    query: str
