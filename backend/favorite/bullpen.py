"""Factor 3 — Bullpen quality + recent workload (max 12).

Quality: our own 1..30 ranking from IP-weighted reliever ERA/WHIP (same
daily league pull as the SP table). Workload: relievers used across the
team's finished games in the last 3 days."""

from backend.favorite import data

MAX = 12


async def score(team_id: int) -> dict:
    rank = (await data.league_pitching())["pen_rank"].get(team_id)
    if rank is None:
        return {"key": "bullpen", "points": 0, "max": MAX, "ok": False,
                "detail": "no bullpen data"}
    used = await data.pen_used_last3(team_id)
    taxed = used is not None and used >= 10
    if rank <= 8 and not taxed and (used or 0) <= 6:
        pts = 12
    elif rank <= 15 and not taxed:
        pts = 8
    elif rank <= 22 and not taxed:
        pts = 5
    else:
        pts = 2 if rank <= 26 and not taxed else 0
    return {"key": "bullpen", "points": pts, "max": MAX, "ok": True,
            "detail": f"pen rank #{rank}, {used if used is not None else '?'} relievers used in 3 days"}
