"""Builds the human-readable 'Analyze' snapshot for one MLB game — everything
in one paste: score, situation, batter/pitcher, due-up lineup, records and
weather. All from the MLB full feed (feed/live) plus one head-to-head call."""

import datetime
from zoneinfo import ZoneInfo

from backend.mlb import client

ET = ZoneInfo("America/New_York")


def _bases(offense: dict) -> str:
    on = []
    if offense.get("first"):
        on.append("1st")
    if offense.get("second"):
        on.append("2nd")
    if offense.get("third"):
        on.append("3rd")
    if not on:
        return "Empty"
    if len(on) == 3:
        return "Bases loaded"
    return "Runner on " + " & ".join(on)


def _offense_defense(ls: dict) -> tuple[str, str]:
    """(offense_side, defense_side). During a between-halves break the batting
    team is the one coming up next."""
    state = ls.get("inningState")
    if state == "Middle":   # top just ended -> home comes up
        return "home", "away"
    if state == "End":      # inning over -> away comes up next
        return "away", "home"
    if state == "Bottom":
        return "home", "away"
    return "away", "home"   # "Top" (or anything else)


async def _season_series(away_id, home_id, year, away_name, home_name) -> str:
    try:
        r = await client._http().get(
            f"{client.BASE}/v1/schedule",
            params={"sportId": 1, "season": year, "gameType": "R",
                    "teamId": away_id, "opponentId": home_id},
        )
        r.raise_for_status()
        aw = hw = 0
        for d in r.json().get("dates", []):
            for g in d.get("games", []):
                if g["status"]["abstractGameState"] != "Final":
                    continue
                t = g["teams"]
                if t["away"].get("isWinner"):
                    wid = t["away"]["team"]["id"]
                elif t["home"].get("isWinner"):
                    wid = t["home"]["team"]["id"]
                else:
                    continue
                if wid == away_id:
                    aw += 1
                elif wid == home_id:
                    hw += 1
        if aw == 0 and hw == 0:
            return "no completed meetings yet"
        if aw == hw:
            return f"tied {aw}-{hw}"
        if aw > hw:
            return f"{away_name} leads {aw}-{hw}"
        return f"{home_name} leads {hw}-{aw}"
    except Exception:
        return "N/A"


async def analyze_text(game_pk: int) -> str:
    r = await client._http().get(f"{client.BASE}/v1.1/game/{game_pk}/feed/live")
    r.raise_for_status()
    feed = r.json()
    gd, ld = feed["gameData"], feed["liveData"]
    ls = ld["linescore"]
    box = ld["boxscore"]["teams"]
    players = gd.get("players", {})
    off_side, def_side = _offense_defense(ls)

    away, home = gd["teams"]["away"], gd["teams"]["home"]
    a_ls, h_ls = ls["teams"]["away"], ls["teams"]["home"]
    ar, hr = a_ls.get("runs", 0) or 0, h_ls.get("runs", 0) or 0

    def pid_key(pid):
        return f"ID{pid}"

    def ops(side, pid):
        return (box[side]["players"].get(pid_key(pid), {})
                .get("seasonStats", {}).get("batting", {}).get("ops"))

    def hand(pid):
        return players.get(pid_key(pid), {}).get("batSide", {}).get("code")

    def name(side, pid):
        return (box[side]["players"].get(pid_key(pid), {})
                .get("person", {}).get("fullName"))

    offense = ls.get("offense", {})
    defense = ls.get("defense", {})
    batter = offense.get("batter", {}) or {}
    pitcher = defense.get("pitcher", {}) or {}

    # pitcher game pitch count + season ERA
    pp = box[def_side]["players"].get(pid_key(pitcher.get("id", 0)), {})
    gp = pp.get("stats", {}).get("pitching", {})  # this-game line
    pitches = gp.get("numberOfPitches")
    era = pp.get("seasonStats", {}).get("pitching", {}).get("era")
    pitcher_line = (
        f"{gp.get('inningsPitched', '0.0')} IP, {gp.get('hits', 0)} H, "
        f"{gp.get('runs', 0)} R, {gp.get('earnedRuns', 0)} ER, "
        f"{gp.get('baseOnBalls', 0)} BB, {gp.get('strikeOuts', 0)} K, "
        f"{gp.get('homeRuns', 0)} HR"
    )

    # batter OPS
    b_ops = ops(off_side, batter.get("id", 0))

    # due up: the next batters in the offense's order after the current batter
    order = box[off_side].get("battingOrder") or []
    due = []
    if order:
        try:
            start = order.index(batter.get("id")) + 1
        except ValueError:
            start = 0
        for k in range(6):
            pid = order[(start + k) % len(order)]
            due.append((name(off_side, pid), ops(off_side, pid), hand(pid) or "?"))

    status = gd["status"]["abstractGameState"]
    state = ls.get("inningState")
    is_break = state in ("Middle", "End")

    if ar == hr:
        trailing = f"Tied {ar}-{hr}"
    elif ar < hr:
        trailing = away["name"]
    else:
        trailing = home["name"]

    def record(t):
        rec = t.get("record", {})
        w, l = rec.get("wins"), rec.get("losses")
        pct = rec.get("winningPercentage") or rec.get("leagueRecord", {}).get("pct")
        rank = rec.get("divisionRank") or rec.get("leagueRank")
        base = f"{w}-{l}" if w is not None else "N/A"
        if pct:
            base += f" ({pct}"
            base += f", div rank #{rank})" if rank else ")"
        return base

    w = gd.get("weather", {}) or {}
    if w.get("condition"):
        wind = (w.get("wind") or "").replace(", None", "").strip()
        weather = f"{w.get('condition')}, {w.get('temp')}°F" + (f", wind {wind}" if wind else "")
    else:
        weather = "N/A"

    year = datetime.datetime.now(ET).year
    series = await _season_series(away["id"], home["id"], year, away["name"], home["name"])
    now = datetime.datetime.now(ET).strftime("%Y-%m-%d %I:%M %p ET")

    half = "Top" if ls.get("isTopInning") else "Bottom"
    inning_line = (f"End of {half} {ls.get('currentInning')} (break — {trailing_up(off_side, away, home)} up next)"
                   if is_break else f"{half} of the {ls.get('currentInning')}")

    batter_label = "Leading off next" if is_break else "Current batter"
    lines = [
        f"Teams: {away['name']} @ {home['name']}",
        f"Stadium / Park: {gd.get('venue', {}).get('name')}",
        f"Date/Time: {now}",
        "",
        f"Current Score: {away['abbreviation']} {ar} – {hr} {home['abbreviation']}",
        f"Hits / Errors: {away['abbreviation']} {a_ls.get('hits', 0)}-{a_ls.get('errors', 0)}  |  "
        f"{home['abbreviation']} {h_ls.get('hits', 0)}-{h_ls.get('errors', 0)}",
        f"Trailing Team: {trailing}",
        "",
        f"Inning: {inning_line}",
        f"Outs: {ls.get('outs', 0)}",
        f"Bases: {_bases(offense)}",
        f"Count: {ls.get('balls', 0)}-{ls.get('strikes', 0)} on {batter.get('fullName', '—')}",
        "",
        f"Pitcher on mound: {pitcher.get('fullName', '—')} "
        f"(pitch count: {pitches if pitches is not None else 'n/a'}, season ERA {era or 'n/a'})",
        f"  This game: {pitcher_line}",
        f"{batter_label}: {batter.get('fullName', '—')} (OPS {b_ops or 'n/a'})",
        "",
        "Next batters due up:",
    ]
    for i, (nm, o, h) in enumerate(due, 1):
        lines.append(f"  {i}. {nm} – OPS {o or 'n/a'}, bats {h}")
    lines += [
        "",
        "Team form & matchup notes:",
        f"- {away['name']} record this season: {record(away)}",
        f"- {home['name']} record this season: {record(home)}",
        f"- Season series: {series}",
        f"- Weather: {weather}",
        f"- Game status: {gd['status'].get('detailedState')}",
    ]
    return "\n".join(lines)


def trailing_up(off_side, away, home):
    return (away if off_side == "away" else home)["abbreviation"]
