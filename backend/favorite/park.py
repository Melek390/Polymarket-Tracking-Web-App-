"""Factor 8 — Park / weather (max 5).

v1 is deliberately conservative: neutral 2 points unless the forecast at
the home park is extreme (high wind / likely rain / temperature extremes),
which zeroes the factor and raises the spec's weather-uncertainty flag.
Park factor and platoon-handedness edges are noted v2 refinements — a
5-point factor almost never decides a 75-point threshold."""

from backend.favorite import data

MAX = 5


async def score(home_team_id: int, kickoff_iso: str | None) -> dict:
    wx = await data.weather(home_team_id, kickoff_iso)
    pf = (data.STADIUMS.get(home_team_id) or (None, None, 100))[2]
    if wx and wx["extreme"]:
        bits = []
        if (wx["wind_kmh"] or 0) >= 32:
            bits.append(f"wind {wx['wind_kmh']:.0f} km/h")
        if (wx["precip_pct"] or 0) >= 60:
            bits.append(f"rain {wx['precip_pct']:.0f}%")
        t = wx["temp_c"]
        if t is not None and (t <= 2 or t >= 38):
            bits.append(f"{t:.0f}°C")
        return {"key": "park", "points": 0, "max": MAX, "ok": True,
                "extreme_weather": True,
                "detail": f"extreme weather ({', '.join(bits)}), park {pf}"}
    detail = f"park factor {pf}"
    if wx and wx["temp_c"] is not None:
        detail += f", {wx['temp_c']:.0f}°C"
    return {"key": "park", "points": 2, "max": MAX, "ok": True, "detail": detail}
