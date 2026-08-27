"""/api/lol — team scorecards for the esports screener rows."""
import logging

from fastapi import APIRouter, Query

from backend.lol import service, store

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/lol", tags=["lol"])


@router.get("/scores")
def scores(slugs: str = Query("", description="comma-separated event slugs")):
    """{slug: scorecard}. Reads the stored cards only — the sweep writes
    them, so a page load never waits on Oracle's Elixir."""
    wanted = [s for s in (slugs or "").split(",") if s]
    return {"scores": store.get_scores(wanted or None)}


@router.post("/refresh")
async def refresh():
    """Force a sweep (the scheduler runs one daily)."""
    return await service.run()
