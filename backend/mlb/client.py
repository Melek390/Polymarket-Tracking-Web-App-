"""MLB Stats API client — the live game feed baseball rows are enriched with.
Polymarket's own MLB scores are unreliable, so game state comes from here."""

import httpx

BASE = "https://statsapi.mlb.com/api"
TIMEOUT = 8.0  # bound any slow statsapi call so it can't stall the worker

# One shared client, reused across calls. Creating a new httpx.AsyncClient per
# call rebuilds the SSL context every time — ssl.create_default_context() loads
# and parses the whole system CA bundle from disk SYNCHRONOUSLY, blocking the
# event loop. At ~3 MLB calls/s that jammed the worker (markets timed out).
# Reusing one client keeps a single SSL context + pooled keep-alive connections.
_client: httpx.AsyncClient | None = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=TIMEOUT)
    return _client


async def schedule(date: str) -> list[dict]:
    """Every MLB game on a date (YYYY-MM-DD): gamePk, team names, status."""
    r = await _http().get(f"{BASE}/v1/schedule", params={"sportId": 1, "date": date})
    r.raise_for_status()
    games = []
    for day in r.json().get("dates", []):
        for g in day.get("games", []):
            games.append(
                {
                    "game_pk": g["gamePk"],
                    "away": g["teams"]["away"]["team"]["name"],
                    "home": g["teams"]["home"]["team"]["name"],
                    "status": g["status"]["abstractGameState"],  # Preview|Live|Final
                    "detailed": g["status"].get("detailedState"),  # Warmup|In Progress|…
                    "date": g.get("gameDate"),  # ISO UTC first-pitch time
                }
            )
    return games


_TEAM_ABBR: dict[str, str] = {}


async def team_abbreviations() -> dict[str, str]:
    """{full team name: abbreviation}, fetched once (the list never changes)."""
    if not _TEAM_ABBR:
        r = await _http().get(f"{BASE}/v1/teams", params={"sportId": 1})
        r.raise_for_status()
        for t in r.json().get("teams", []):
            _TEAM_ABBR[t["name"]] = t.get("abbreviation", t["name"][:3].upper())
    return _TEAM_ABBR


def offense_defense(ls: dict, away, home, key: str = "id") -> tuple[str, str]:
    """(offense_side, defense_side) for a linescore.

    Trust MLB's own offense/defense teams rather than isTopInning. During a
    between-halves break (inningState Middle/End) they already point at the
    NEXT half while isTopInning has not flipped yet — and that break is exactly
    when relief pitchers are announced, so reading the side off isTopInning
    looked the new pitcher up under the wrong team and lost his season stats.
    Falls back to the inning state if the teams are missing.
    """
    # Before first pitch MLB parks the HOME team in `offense` as a placeholder,
    # so the teams can't be trusted until the game is actually under way.
    if not ls.get("currentInning"):
        return "away", "home"  # the away team always bats first
    off = ((ls.get("offense") or {}).get("team") or {}).get(key)
    dfn = ((ls.get("defense") or {}).get("team") or {}).get(key)
    if off != dfn and off in (away, home) and dfn in (away, home):
        return ("away" if off == away else "home"), ("away" if dfn == away else "home")
    state = ls.get("inningState")
    if state in ("Middle", "Bottom"):  # top just ended / bottom under way -> home bats
        return "home", "away"
    if state in ("End", "Top"):        # inning over / top under way -> away bats
        return "away", "home"
    # nothing to go on (pre-game): the away team always bats first
    return ("home", "away") if ls.get("isTopInning") is False else ("away", "home")


def _clean_stat(value):
    """MLB writes '-.--' (or '.---') for a stat with no value yet — a reliever
    with no innings this season. Show nothing rather than that placeholder."""
    if value is None:
        return None
    text = str(value).strip()
    return None if not text or set(text) <= {"-", "."} else value


async def linescore_state(game_pk: int, away_name: str, home_name: str, status: str,
                          detailed: str | None = None) -> dict:
    """Compact live state from the light 3 KB linescore endpoint (no season
    stats). Same shape as live_game with era/ops left None."""
    r = await _http().get(f"{BASE}/v1/game/{game_pk}/linescore")
    r.raise_for_status()
    ls = r.json()
    abbr = await team_abbreviations()
    offense = ls.get("offense", {})
    defense = ls.get("defense", {})
    # the light linescore only names the teams, so match on name
    off_side, _def_side = offense_defense(ls, away_name, home_name, key="name")

    def team(side, name):
        t = ls["teams"][side]
        return {
            "name": name,
            "abbr": abbr.get(name, name[:3].upper()),
            "runs": t.get("runs"),
            "hits": t.get("hits"),
            "errors": t.get("errors"),
        }

    return {
        "status": status,
        # season stats (ERA / OPS) only come from the heavy feed — see live_game
        "full": False,
        "detail": ls.get("inningState") or status,
        # detailedState from the schedule: Warmup | In Progress | Delayed | …
        "game_state": detailed,
        # Top | Middle | Bottom | End. Middle/End are the between-half breaks.
        "inning_state": ls.get("inningState"),
        "inning": ls.get("currentInning"),
        "inning_half": ls.get("inningHalf"),
        "is_top": ls.get("isTopInning"),
        "balls": ls.get("balls"),
        "strikes": ls.get("strikes"),
        "outs": ls.get("outs"),
        "bases": {
            "first": bool(offense.get("first")),
            "second": bool(offense.get("second")),
            "third": bool(offense.get("third")),
        },
        "away": team("away", away_name),
        "home": team("home", home_name),
        "batting": off_side,
        # neither of these is in the linescore; the poller attaches both
        "last_pitch": None,
        "pitchers": None,
        "batter": {"name": (offense.get("batter") or {}).get("fullName"), "ops": None},
        "pitcher": {"name": (defense.get("pitcher") or {}).get("fullName"), "era": None},
        "innings": [
            {"num": i.get("num"),
             "away": i.get("away", {}).get("runs"),
             "home": i.get("home", {}).get("runs")}
            for i in ls.get("innings", [])
        ],
        "plays": [],  # play-by-play only comes from the full feed (live_game)
    }


def _pitch_from_play(current: dict | None) -> dict | None:
    """The most recent PITCH of the at-bat in progress.

    The count alone cannot show a foul — a foul with two strikes leaves the
    count exactly where it was — so the table needs the pitch result itself.
    MLB spells fouls "Foul", "Foul Tip", "Foul Bunt", "Foul Pitchout".
    """
    for ev in reversed((current or {}).get("playEvents") or []):
        if not ev.get("isPitch"):
            continue  # pickoffs, substitutions, mound visits
        desc = ((ev.get("details") or {}).get("description") or "").strip()
        if not desc:
            return None
        return {"desc": desc, "foul": desc.lower().startswith("foul")}
    return None


async def last_pitch(game_pk: int) -> dict | None:
    """Most recent pitch of the at-bat in progress.

    Uses a FIELD-FILTERED playByPlay call: ~0.5 KB, smaller than the linescore
    we already poll. The unfiltered playByPlay is 487 KB and feed/live is
    704 KB — never poll either of those (see the July 26 feed-flood incidents).
    """
    r = await _http().get(
        f"{BASE}/v1/game/{game_pk}/playByPlay",
        params={"fields": "currentPlay,playEvents,details,description,isPitch,"
                          "count,balls,strikes,outs"},
    )
    r.raise_for_status()
    return _pitch_from_play(r.json().get("currentPlay"))


def _pitchers_from_box(boxscore: dict) -> dict | None:
    """{"away": n, "home": n} — pitchers each side has used so far."""
    teams = (boxscore or {}).get("teams") or {}
    out = {}
    for side in ("away", "home"):
        used = (teams.get(side) or {}).get("pitchers")
        if used is None:
            return None
        out[side] = len(used)
    return out


async def pitchers_used(game_pk: int) -> dict | None:
    """How many pitchers each side has used so far in this game.

    Field-filtered boxscore, ~8.5 KB — the per-player map cannot be pruned any
    further, which is why the poller refreshes this on a SLOWER cadence than
    the 3 KB linescore rather than every cycle.

    Timing, measured by timecode replay: MLB only counts a reliever once he
    throws his first pitch, about 1-2 minutes after the change is announced.
    Polling harder does not make a change show up sooner.
    """
    r = await _http().get(
        f"{BASE}/v1/game/{game_pk}/boxscore",
        params={"fields": "teams,away,home,pitchers"},
    )
    r.raise_for_status()
    return _pitchers_from_box(r.json())


def _season_stat(boxscore: dict, side: str, player_id, group: str, key: str):
    """Pull one season stat (era / ops) for a player from the boxscore."""
    if not player_id:
        return None
    player = boxscore["teams"][side]["players"].get(f"ID{player_id}", {})
    return _clean_stat(player.get("seasonStats", {}).get(group, {}).get(key))


def _game_pitching_line(boxscore: dict, side: str, player_id) -> str | None:
    """This pitcher's line in THIS game, e.g. "0.2 IP, 1 H, 0 R, 2 K, 11 P".
    None before he has thrown a pitch."""
    if not player_id:
        return None
    player = boxscore["teams"][side]["players"].get(f"ID{player_id}", {})
    st = player.get("stats", {}).get("pitching", {})
    if not st:
        return None
    parts = [f"{st.get('inningsPitched', '0.0')} IP",
             f"{st.get('hits', 0)} H",
             f"{st.get('runs', 0)} R",
             f"{st.get('strikeOuts', 0)} K"]
    if st.get("numberOfPitches"):
        parts.append(f"{st['numberOfPitches']} P")
    return ", ".join(parts)


async def live_game(game_pk: int) -> dict:
    """Compact live state for one game: inning, score, count, bases, batter,
    pitcher and the per-inning line score. All fields tolerate a pre-game or
    finished state (they simply come back as 0 / None)."""
    r = await _http().get(f"{BASE}/v1.1/game/{game_pk}/feed/live")
    r.raise_for_status()
    feed = r.json()

    game = feed["gameData"]
    live = feed["liveData"]
    ls = live["linescore"]
    box = live.get("boxscore", {})
    offense = ls.get("offense", {})
    defense = ls.get("defense", {})
    batter = offense.get("batter") or {}
    pitcher = defense.get("pitcher") or {}
    off_side, def_side = offense_defense(
        ls, game["teams"]["away"]["id"], game["teams"]["home"]["id"]
    )

    # Recent completed plays for the live event feed — newest first. Each play
    # is a finished at-bat (an out, hit, walk, home run…); the in-progress
    # at-bat has no result.event yet, so it's skipped.
    recent = []
    for p in reversed(live.get("plays", {}).get("allPlays", [])):
        res = p.get("result", {})
        ab = p.get("about", {})
        # "Game Advisory" entries are administrative notes (status changes,
        # delays), not plays — they were headlining the feed as if something
        # had happened on the field
        if not res.get("event") or res.get("eventType") == "game_advisory":
            continue
        recent.append({
            "event": res.get("event"),
            "desc": res.get("description"),
            "rbi": res.get("rbi") or 0,
            "scoring": bool(ab.get("isScoringPlay")),
            "half": ab.get("halfInning"),   # top | bottom
            "inning": ab.get("inning"),
        })
        if len(recent) >= 5:
            break

    def team(side):
        t = ls["teams"][side]
        return {
            "name": game["teams"][side]["name"],
            "abbr": game["teams"][side]["abbreviation"],
            "runs": t.get("runs"),
            "hits": t.get("hits"),
            "errors": t.get("errors"),
        }

    return {
        "status": game["status"]["abstractGameState"],  # Preview | Live | Final
        "full": True,  # carries season stats; the light state does not
        "detail": game["status"]["detailedState"],
        "game_state": game["status"]["detailedState"],  # Warmup | In Progress | …
        # Top | Middle | Bottom | End. Middle/End are the between-half breaks.
        "inning_state": ls.get("inningState"),
        "inning": ls.get("currentInning"),
        "inning_half": ls.get("inningHalf"),  # Top | Bottom
        "is_top": ls.get("isTopInning"),
        "balls": ls.get("balls"),
        "strikes": ls.get("strikes"),
        "outs": ls.get("outs"),
        "bases": {
            "first": bool(offense.get("first")),
            "second": bool(offense.get("second")),
            "third": bool(offense.get("third")),
        },
        "away": team("away"),
        "home": team("home"),
        "batting": off_side,
        # both already in this payload — no extra calls on the heavy path
        "last_pitch": _pitch_from_play(live.get("plays", {}).get("currentPlay")),
        "pitchers": _pitchers_from_box(box),
        "batter": {
            "name": batter.get("fullName"),
            "ops": _season_stat(box, off_side, batter.get("id"), "batting", "ops"),
        },
        "pitcher": {
            "name": pitcher.get("fullName"),
            "era": _season_stat(box, def_side, pitcher.get("id"), "pitching", "era"),
            # this game's line — a reliever who just came in has no innings yet,
            # so this is how you tell a fresh arm from one that's been worked
            "line": _game_pitching_line(box, def_side, pitcher.get("id")),
        },
        "innings": [
            {"num": i.get("num"),
             "away": i.get("away", {}).get("runs"),
             "home": i.get("home", {}).get("runs")}
            for i in ls.get("innings", [])
        ],
        "plays": recent,
    }
