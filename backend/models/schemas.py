"""Request bodies for the REST API."""

from pydantic import BaseModel, Field


class LookupRequest(BaseModel):
    url_or_slug: str


class TrackRequest(BaseModel):
    slug: str
    market_condition_ids: list[str]


class MarketPatch(BaseModel):
    poll_interval: int = Field(ge=1, le=3600)


class ScreenerRequest(BaseModel):
    query: str
