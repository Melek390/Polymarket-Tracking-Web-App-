"""Factor 5 — Rest / travel / schedule spot (max 10).

From the two teams' schedules: days off before today, and whether the
opponent both played yesterday and changed venue (travel burden)."""

from datetime import datetime, timedelta

from backend.favorite import data

MAX = 10


async def _spot(team_id: int, today_venue: int | None) -> dict:
    sched = await data.team_schedule(team_id)
    today = datetime.now().date().isoformat()
    past = [g for g in sched if g["final"] and (g["date"] or "") < today]
    if not past:
        return {"rest": 1, "traveled": False}
    last = past[-1]
    days = (datetime.fromisoformat(today) - datetime.fromisoformat(last["date"])).days - 1
    return {"rest": max(0, days),
            "traveled": bool(today_venue and last["venue_id"]
                             and last["venue_id"] != today_venue)}


async def score(team_id: int, opp_id: int, venue_id: int | None) -> dict:
    mine = await _spot(team_id, venue_id)
    theirs = await _spot(opp_id, venue_id)
    if mine["rest"] > theirs["rest"] and theirs["rest"] == 0 and theirs["traveled"]:
        pts = 10
    elif mine["rest"] > theirs["rest"]:
        pts = 7
    elif mine["rest"] == theirs["rest"]:
        pts = 5
    elif theirs["rest"] - mine["rest"] == 1:
        pts = 2
    else:
        pts = 0
    return {"key": "rest", "points": pts, "max": MAX, "ok": True,
            "detail": (f"rest {mine['rest']}d vs {theirs['rest']}d"
                       + (", opponent traveling" if theirs["traveled"] else ""))}
