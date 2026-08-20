"""/api/bottom8 — the MLB Bottom 8th Innings page.

  GET /  every tracked game plus the accumulated record underneath it
"""

from fastapi import APIRouter

from backend.bottom8 import store

router = APIRouter(prefix="/api/bottom8", tags=["bottom8"])


def _row(r: dict) -> dict:
    """One table row, with the two links the client asked for: the chart
    (via the slug the Dashboard button tracks) and the game on MLB.com."""
    return {
        **r,
        # gamePk is already known here, so the MLB link needs no lookup
        "mlb_url": f"https://www.mlb.com/gameday/{r['game_pk']}",
        "went_to_extras": r["extras_inning"] is not None,
    }


@router.get("")
def page(limit: int = 500):
    return {"rows": [_row(r) for r in store.rows(limit)],
            "stats": store.stats(),
            "bands": store.price_bands(),
            "movement": store.movement(),
            "teams": store.team_table()}
