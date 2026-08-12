"""Factor 2 — Starting pitcher quality gap (max 18).

The client's spec allows "your internal SP rating": every qualified starter
(5+ starts, 30+ IP) gets a z-composite of ERA / WHIP / K-per-9, re-scaled to
true league standard deviations (data.league_pitching). The factor scores
the SD gap between today's two probables, exactly per the spec's bands.

An unannounced probable or one with no qualified season line is the spec's
"bullpen game / emergency call-up" — flagged for the hard rules."""

from backend.favorite import data

MAX = 18


async def score(my_pid: int | None, opp_pid: int | None) -> dict:
    table = (await data.league_pitching())["starters"]
    mine, theirs = table.get(my_pid), table.get(opp_pid)
    if not my_pid or not opp_pid:
        # Not a data failure — MLB simply hasn't posted it yet (4 of 15 games
        # on a normal morning). Flagged separately so the verdict can say so
        # instead of reporting it as missing data.
        return {"key": "sp", "points": 0, "max": MAX, "ok": False,
                "unannounced": True,
                "detail": "probable starter not announced yet"}
    if not mine or not theirs:
        who = "ours" if not mine else "theirs"
        return {"key": "sp", "points": 0, "max": MAX, "ok": False,
                "emergency": True,
                "detail": f"no qualified season line for {who} (bullpen game / call-up)"}
    gap = mine["rating"] - theirs["rating"]
    if gap >= 1.5:
        pts = 18
    elif gap >= 0.7:
        pts = 12
    elif gap >= 0.3:
        pts = 8
    elif gap >= 0.1:
        pts = 4
    else:
        pts = 0
    # a rating built mostly out of relief innings is still a rating, but say so
    def _tag(p):
        return "" if p.get("regular_starter", True) else " (swingman)"

    return {"key": "sp", "points": pts, "max": MAX, "ok": True, "gap_sd": round(gap, 2),
            "detail": (f"{mine['name']}{_tag(mine)} {mine['rating']:+.2f} SD vs "
                       f"{theirs['name']}{_tag(theirs)} {theirs['rating']:+.2f} SD "
                       f"(gap {gap:+.2f})")}
