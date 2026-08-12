"""Factor 2 — Starting pitcher quality + projected IP (max 18).

The client's spec allows "your internal SP rating": every qualified starter
(5+ starts, 30+ IP) gets a z-composite of ERA / WHIP / K-per-9, re-scaled to
true league standard deviations (data.league_pitching). The factor scores the
SD gap between today's two probables, on the spec's bands.

The spec titles this factor "quality + PROJECTED IP", and the first cut only
scored quality — an ace who hands a lead to a bad bullpen in the 5th was
graded identically to the same ace going 7. MLB publishes no innings
projection, so season IP/GS stands in for expected length of start, and the
depth gap adjusts the quality score. It only adjusts: the spec's own bands
still decide the base, so his numbers are recognisable.

An unannounced probable or one with no qualified season line is the spec's
"bullpen game / emergency call-up" — flagged for the hard rules."""

from backend.favorite import data

MAX = 18
# below this a "starter" is an opener and the bullpen is pitching the game
OPENER_IP_PER_START = 4.0


def _ip_per_start(p: dict) -> float | None:
    """Expected length of start, or None when we cannot honestly claim one.

    MLB's `ip` is TOTAL innings — starts AND relief — so dividing by games
    STARTED inflates anyone who does both: Carmen Mlodzinski came out at 9.7
    IP/start, which no pitcher on earth averages. So this is only claimed for
    pitchers who essentially only start (85%+ of appearances), and a result
    above 8.0 is treated as bad data rather than a heroic workload."""
    gs, g = p.get("gs") or 0, p.get("g") or 0
    if gs < 5 or not g or gs / g < 0.85:
        return None
    per = p["ip"] / gs
    return per if per <= 8.0 else None


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

    # --- quality, on the spec's bands (2+ SD is the sheet's top band) --------
    gap = mine["rating"] - theirs["rating"]
    if gap >= 2.0:
        base = 18
    elif gap >= 0.7:
        base = 12
    elif gap >= 0.3:
        base = 8
    elif gap >= 0.1:
        base = 4
    else:
        base = 0

    # --- projected IP -------------------------------------------------------
    my_ipgs, their_ipgs = _ip_per_start(mine), _ip_per_start(theirs)
    adj, depth = 0, None
    if my_ipgs is not None and their_ipgs is not None:
        depth = my_ipgs - their_ipgs
        if depth >= 1.0:
            adj = 1
        elif depth <= -1.5:
            adj = -3
        elif depth <= -1.0:
            adj = -2
        elif depth <= -0.5:
            adj = -1
    if my_ipgs is not None and my_ipgs < OPENER_IP_PER_START:
        adj -= 2  # our guy is an opener however good his rate stats look
    pts = max(0, min(MAX, base + adj))

    # a rating built mostly out of relief innings is still a rating, but say so
    def _tag(p):
        return "" if p.get("regular_starter", True) else " (swingman)"

    detail = (f"{mine['name']}{_tag(mine)} {mine['rating']:+.2f} SD vs "
              f"{theirs['name']}{_tag(theirs)} {theirs['rating']:+.2f} SD "
              f"(gap {gap:+.2f})")
    if depth is not None:
        detail += (f"; proj IP {my_ipgs:.1f} vs {their_ipgs:.1f}"
                   + (f" ({adj:+d})" if adj else ""))
    elif adj:
        detail += f" ({adj:+d} short outing)"
    return {"key": "sp", "points": pts, "max": MAX, "ok": True,
            "gap_sd": round(gap, 2), "detail": detail}
