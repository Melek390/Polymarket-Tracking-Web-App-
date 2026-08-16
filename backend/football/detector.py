"""The soccer 0-0 alert — the criteria, as a PURE function.

Client's spec (Aug 15), all three legs required:
  1. one of the big-5 European leagues        (the row/fixture got here
     through the league filter, so this is already true)
  2. a clear pre-match favorite: one side at 60c or more BEFORE kickoff
  3. score 0-0 at the 60th minute

live.py feeds this from its cache; keeping the decision pure makes it
testable without an API key or a live match.
"""

from datetime import datetime, timezone


def check(fixture: dict, row: dict, pre: dict, stats: dict | None,
          cfg: dict) -> dict | None:
    """Trigger payload when every leg of the spec holds, else None."""
    if not cfg.get("enabled"):
        return None

    # leg 3 — 0-0 at (or past) the check minute, match still running
    elapsed = fixture.get("elapsed")
    if elapsed is None or elapsed < int(cfg["min_minute"]):
        return None
    if fixture.get("status") not in ("1H", "HT", "2H", "ET"):
        return None
    if fixture.get("home_goals") != 0 or fixture.get("away_goals") != 0:
        return None

    # leg 2 — clear pre-match favorite
    bar = float(cfg["min_favorite_cents"])
    home_pre, away_pre = pre.get("home"), pre.get("away")
    favorite = None
    if home_pre is not None and home_pre >= bar:
        favorite = "home"
    elif away_pre is not None and away_pre >= bar:
        favorite = "away"
    if favorite is None:
        return None

    # the red-card consideration: shown always, a gate only if configured
    fav_reds = (stats or {}).get(favorite, {}).get("red_cards") or 0
    if cfg.get("skip_if_favorite_red_card") and fav_reds > 0:
        return None

    return {
        "league": fixture.get("league"),
        "slug": row.get("event_slug"),
        "home_name": fixture.get("home") or row.get("home_team"),
        "away_name": fixture.get("away") or row.get("away_team"),
        "minute": elapsed,
        "score": "0-0",
        "favorite": favorite,
        "favorite_name": (fixture.get("home") if favorite == "home"
                          else fixture.get("away")),
        "prematch_home_cents": home_pre,
        "prematch_away_cents": away_pre,
        "favorite_red_cards": fav_reds,
        "stats": stats,
        "config_at_trigger": dict(cfg),
        "detected_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
