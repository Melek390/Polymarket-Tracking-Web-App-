"""Storage for the Bottom-8th tracking page.

One row per game that was TIED at the middle of the 8th — the moment the top
of the 8th ends and the bottom is about to start. The row is opened at that
instant with the score and both Polymarket prices, then kept up to date as
the game plays out: the highest price each side reaches, the score and home
price at the start of the bottom 9th (when there is one), whether it went to
extras, and the final score.

Rows are never deleted: the whole point is the accumulated record.
"""

import json
import time
from datetime import datetime, timezone

from backend.database.db import get_db

SCHEMA = """
CREATE TABLE IF NOT EXISTS bottom8_games (
    game_pk        INTEGER PRIMARY KEY,
    game_date      TEXT NOT NULL,          -- MLB's official (local) date
    slug           TEXT,                   -- Polymarket event, for the chart
    away_name      TEXT NOT NULL,
    home_name      TEXT NOT NULL,
    away_abbr      TEXT,
    home_abbr      TEXT,
    b8_away_runs   INTEGER NOT NULL,       -- tied, so both are the same
    b8_home_runs   INTEGER NOT NULL,
    b8_home_price  REAL,                   -- cents at the middle of the 8th
    b8_away_price  REAL,
    home_high      REAL,                   -- best price each side reached
    away_high      REAL,                   -- after the trigger
    b9_away_runs   INTEGER,                -- NULL when there was no bottom 9th
    b9_home_runs   INTEGER,
    b9_home_price  REAL,
    extras_inning  INTEGER,                -- last inning, only when > 9
    final_away     INTEGER,
    final_home     INTEGER,
    winner         TEXT,                   -- 'home' | 'away'
    status         TEXT NOT NULL DEFAULT 'tracking',   -- tracking|final|stale
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_bottom8_date ON bottom8_games(game_date DESC);
"""


def init():
    with get_db() as conn:
        conn.executescript(SCHEMA)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def open_row(game: dict) -> bool:
    """Record a game at the middle of the 8th. True only the FIRST time —
    the tracker re-runs every few seconds and must not re-open a row."""
    with get_db() as conn:
        cur = conn.execute(
            """INSERT OR IGNORE INTO bottom8_games
               (game_pk, game_date, slug, away_name, home_name, away_abbr,
                home_abbr, b8_away_runs, b8_home_runs, b8_home_price,
                b8_away_price, home_high, away_high)
               VALUES (:game_pk, :game_date, :slug, :away_name, :home_name,
                       :away_abbr, :home_abbr, :runs, :runs, :home_price,
                       :away_price, :home_price, :away_price)""", game)
        return cur.rowcount == 1


def tracking(max_age_hours: int = 12) -> list[dict]:
    """Rows still being followed. Anything older than the cap has been left
    behind by a suspended or postponed game and is retired instead of being
    chased forever."""
    with get_db() as conn:
        conn.execute(
            """UPDATE bottom8_games SET status='stale', updated_at=?
               WHERE status='tracking'
                 AND created_at < strftime('%Y-%m-%dT%H:%M:%SZ','now',?)""",
            (_now(), f"-{int(max_age_hours)} hours"))
        return [dict(r) for r in conn.execute(
            "SELECT * FROM bottom8_games WHERE status='tracking'")]


def update(game_pk: int, fields: dict):
    if not fields:
        return
    sets = ", ".join(f"{k}=:{k}" for k in fields)
    with get_db() as conn:
        conn.execute(f"UPDATE bottom8_games SET {sets}, updated_at=:_now "
                     "WHERE game_pk=:_pk",
                     {**fields, "_now": _now(), "_pk": game_pk})


def rows(limit: int = 500) -> list[dict]:
    with get_db() as conn:
        return [dict(r) for r in conn.execute(
            """SELECT * FROM bottom8_games
               ORDER BY game_date DESC, created_at DESC LIMIT ?""",
            (max(1, min(2000, limit)),))]


def stats() -> dict:
    """The accumulated record the client asked for, over FINISHED games only:
    a game still in progress has no winner to count."""
    with get_db() as conn:
        r = conn.execute(
            """SELECT
                 COUNT(*) AS tracked,
                 SUM(winner='home') AS home_wins,
                 SUM(winner='away') AS away_wins,
                 SUM(extras_inning IS NOT NULL) AS extras,
                 SUM(extras_inning IS NOT NULL AND winner='home') AS extras_home,
                 SUM(extras_inning IS NOT NULL AND winner='away') AS extras_away
               FROM bottom8_games WHERE status='final'""").fetchone()
    tracked = r["tracked"] or 0
    home, away = r["home_wins"] or 0, r["away_wins"] or 0
    extras = r["extras"] or 0
    e_home, e_away = r["extras_home"] or 0, r["extras_away"] or 0
    pct = lambda n, d: round(n / d * 100, 1) if d else None
    return {
        "games_tracked": tracked,
        "home_wins": home, "away_wins": away,
        "home_win_pct": pct(home, home + away),
        "away_win_pct": pct(away, home + away),
        "games_to_extras": extras,
        "extras_pct": pct(extras, tracked),
        "home_wins_extras": e_home, "away_wins_extras": e_away,
        "home_win_pct_extras": pct(e_home, e_home + e_away),
    }
