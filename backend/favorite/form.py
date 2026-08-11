"""Factor 7 — Recent form, regression-aware (max 5).

Last 10 finished games: the record AND the run differential over those
games, so a lucky 7-3 with a negative margin doesn't score as "strong".
(Statcast xwOBA is the noted v2 refinement.)"""

from backend.favorite import data

MAX = 5


async def score(team_id: int) -> dict:
    sched = [g for g in await data.team_schedule(team_id) if g["final"]]
    last10 = sched[-10:]
    if len(last10) < 5:
        return {"key": "form", "points": 2, "max": MAX, "ok": True,
                "detail": "thin sample (neutral)"}
    wins = sum(1 for g in last10 if g["won"])
    diff = sum((g["my_runs"] or 0) - (g["opp_runs"] or 0) for g in last10)
    if wins >= 7 or (wins >= 6 and diff >= 10):
        pts = 5
    elif wins >= 6 or (wins >= 5 and diff > 0):
        pts = 3
    elif wins >= 4:
        pts = 2
    else:
        pts = 1 if diff > -15 else 0
    return {"key": "form", "points": pts, "max": MAX, "ok": True,
            "detail": f"last {len(last10)}: {wins}W-{len(last10) - wins}L, run diff {diff:+d}"}
