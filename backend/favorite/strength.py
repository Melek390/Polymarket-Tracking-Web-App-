"""Factor 4 — True team strength (max 12).

Pythagorean win% from runs scored/allowed (exponent 1.83). The spec's
strength-of-schedule adjustment is a noted v2 refinement — the client
approved plain Pythagorean for v1."""

from backend.favorite import data

MAX = 12


def _pythag(rs: float, ra: float) -> float:
    if not rs or not ra:
        return 0.5
    e = 1.83
    return rs ** e / (rs ** e + ra ** e)


async def score(team_id: int, opp_id: int) -> dict:
    table = await data.standings()
    mine, theirs = table.get(team_id), table.get(opp_id)
    if not mine or not theirs or mine["rs"] is None or theirs["rs"] is None:
        return {"key": "strength", "points": 0, "max": MAX, "ok": False,
                "detail": "standings data missing"}
    edge = (_pythag(mine["rs"], mine["ra"]) - _pythag(theirs["rs"], theirs["ra"])) * 100
    if edge >= 8:
        pts = 12
    elif edge >= 4:
        pts = 7
    elif edge >= 2:
        pts = 4
    elif edge >= 1:
        pts = 2
    else:
        pts = 0
    return {"key": "strength", "points": pts, "max": MAX, "ok": True,
            "detail": f"Pythagorean edge {edge:+.1f}pp"}
