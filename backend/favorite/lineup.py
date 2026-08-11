"""Factor 6 — Lineup & key player availability (max 10).

"High-impact players" = the team's top five regulars by season OPS (150+
PA). Once today's lineup is confirmed we count how many of them start;
before it posts the factor stays neutral, and a lineup still missing close
to first pitch raises the spec's pending-uncertainty flag."""

from datetime import datetime, timezone

from backend.favorite import data
from backend.mlb import matchup as mlb_matchup

MAX = 10


async def score(team_id: int, game_pk: int, side: str, kickoff_iso: str | None) -> dict:
    lineups = await mlb_matchup._game_lineups(game_pk, immutable=False)
    nine = (lineups.get(side) or {}).get("ids") or []
    if not nine:
        pending = False
        if kickoff_iso:
            try:
                mins = (datetime.fromisoformat(kickoff_iso.replace("Z", "+00:00"))
                        - datetime.now(timezone.utc)).total_seconds() / 60
                pending = mins <= 90
            except ValueError:
                pass
        return {"key": "lineup", "points": 6, "max": MAX, "ok": True,
                "pending": pending, "detail": "lineup not posted yet (neutral)"}
    top = await data.team_top_hitters(team_id)
    if not top:
        return {"key": "lineup", "points": 6, "max": MAX, "ok": True,
                "detail": "no hitter table (neutral)"}
    present = sum(1 for p in top if p["id"] in nine)
    missing = [p["name"] for p in top if p["id"] not in nine]
    pts = {5: 10, 4: 6, 3: 3}.get(present, 0) if len(top) >= 5 else 10
    return {"key": "lineup", "points": pts, "max": MAX, "ok": True,
            "detail": (f"{present}/{len(top)} top bats start"
                       + (f" (missing {', '.join(missing)})" if missing else ""))}
