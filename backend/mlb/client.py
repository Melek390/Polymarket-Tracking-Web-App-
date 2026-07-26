"""MLB Stats API client — the live game feed baseball rows are enriched with.
Polymarket's own MLB scores are unreliable, so game state comes from here."""

import httpx

BASE = "https://statsapi.mlb.com/api"
TIMEOUT = 8.0  # bound any slow statsapi call so it can't stall the worker


async def schedule(date: str) -> list[dict]:
    """Every MLB game on a date (YYYY-MM-DD): gamePk, team names, status."""
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.get(f"{BASE}/v1/schedule", params={"sportId": 1, "date": date})
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
                    "date": g.get("gameDate"),  # ISO UTC first-pitch time
                }
            )
    return games


_TEAM_ABBR: dict[str, str] = {}


async def team_abbreviations() -> dict[str, str]:
    """{full team name: abbreviation}, fetched once (the list never changes)."""
    if not _TEAM_ABBR:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(f"{BASE}/v1/teams", params={"sportId": 1})
            r.raise_for_status()
        for t in r.json().get("teams", []):
            _TEAM_ABBR[t["name"]] = t.get("abbreviation", t["name"][:3].upper())
    return _TEAM_ABBR


async def linescore_state(game_pk: int, away_name: str, home_name: str, status: str) -> dict:
    """Compact live state from the light 3 KB linescore endpoint (no season
    stats). Same shape as live_game with era/ops left None."""
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.get(f"{BASE}/v1/game/{game_pk}/linescore")
        r.raise_for_status()
    ls = r.json()
    abbr = await team_abbreviations()
    offense = ls.get("offense", {})
    defense = ls.get("defense", {})

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
        "detail": ls.get("inningState") or status,
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
        "batting": "away" if ls.get("isTopInning") else "home",
        "batter": {"name": (offense.get("batter") or {}).get("fullName"), "ops": None},
        "pitcher": {"name": (defense.get("pitcher") or {}).get("fullName"), "era": None},
        "innings": [
            {"num": i.get("num"),
             "away": i.get("away", {}).get("runs"),
             "home": i.get("home", {}).get("runs")}
            for i in ls.get("innings", [])
        ],
    }


async def find_game_pk(team_a: str, team_b: str, date: str) -> int | None:
    """Match two team names (in any order) to their MLB gamePk on a date."""
    pair = {team_a.lower(), team_b.lower()}
    for g in await schedule(date):
        if {g["away"].lower(), g["home"].lower()} == pair:
            return g["game_pk"]
    return None


def _season_stat(boxscore: dict, side: str, player_id, group: str, key: str):
    """Pull one season stat (era / ops) for a player from the boxscore."""
    if not player_id:
        return None
    player = boxscore["teams"][side]["players"].get(f"ID{player_id}", {})
    return player.get("seasonStats", {}).get(group, {}).get(key)


async def live_game(game_pk: int) -> dict:
    """Compact live state for one game: inning, score, count, bases, batter,
    pitcher and the per-inning line score. All fields tolerate a pre-game or
    finished state (they simply come back as 0 / None)."""
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.get(f"{BASE}/v1.1/game/{game_pk}/feed/live")
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
        "detail": game["status"]["detailedState"],
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
        "batting": "away" if ls.get("isTopInning") else "home",
        "batter": {
            "name": batter.get("fullName"),
            "ops": _season_stat(box, "away" if ls.get("isTopInning") else "home",
                                 batter.get("id"), "batting", "ops"),
        },
        "pitcher": {
            "name": pitcher.get("fullName"),
            "era": _season_stat(box, "home" if ls.get("isTopInning") else "away",
                                pitcher.get("id"), "pitching", "era"),
        },
        "innings": [
            {"num": i.get("num"),
             "away": i.get("away", {}).get("runs"),
             "home": i.get("home", {}).get("runs")}
            for i in ls.get("innings", [])
        ],
    }
