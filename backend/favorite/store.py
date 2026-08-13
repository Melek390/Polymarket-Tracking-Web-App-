"""Persisted Clear Favorite verdicts — one snapshot per game, taken shortly
before first pitch and never recomputed.

WHY THIS EXISTS (client, Aug 13): the score used to be recomputed on a 10
minute cache off a price that came from the 15-minute screener cache. During
a live game that produced nonsense — Boston still scored as the 59.5c
favourite while the real market had them at 0.7c, losing 1-6 in the 9th. It
also meant the number moved under him after he had acted on it.

The model is a PRE-GAME model: 72 of its 100 points (starter, bullpen,
strength, rest, lineup, form, park) cannot change once the game starts. So it
is scored ONCE, LOCKED, and served unchanged forever after.

Stored in SQLite rather than memory for the same reason trader_resolutions
is: a restart must not lose a lock and silently re-open a game to rescoring.
"""

import json

from backend.database.db import get_db

SCHEMA = """
CREATE TABLE IF NOT EXISTS favorite_verdicts (
    game_pk     INTEGER PRIMARY KEY,
    locked_at   TEXT NOT NULL,      -- when the snapshot was taken (UTC)
    game_date   TEXT,               -- MLB official local date, for housekeeping
    first_pitch TEXT,               -- ISO UTC, what locked_at was measured against
    payload     TEXT NOT NULL       -- the whole verdict as JSON
);
"""


def init():
    with get_db() as conn:
        conn.executescript(SCHEMA)


def get(game_pk: int) -> dict | None:
    """The locked verdict, or None if this game was never locked."""
    with get_db() as conn:
        r = conn.execute(
            "SELECT locked_at, first_pitch, payload FROM favorite_verdicts WHERE game_pk=?",
            (game_pk,)).fetchone()
    if not r:
        return None
    try:
        payload = json.loads(r["payload"])
    except json.JSONDecodeError:
        return None
    payload["locked"] = True
    payload["locked_at"] = r["locked_at"]
    payload["first_pitch"] = r["first_pitch"]
    return payload


def has(game_pk: int) -> bool:
    with get_db() as conn:
        return conn.execute(
            "SELECT 1 FROM favorite_verdicts WHERE game_pk=?", (game_pk,)).fetchone() is not None


def put(game_pk: int, locked_at: str, game_date: str | None,
        first_pitch: str | None, verdict: dict):
    """Write the snapshot. INSERT OR IGNORE, never UPDATE: a lock is final, and
    a second writer (a restart racing the job) must not overwrite the first."""
    with get_db() as conn:
        conn.execute(
            """INSERT OR IGNORE INTO favorite_verdicts
                   (game_pk, locked_at, game_date, first_pitch, payload)
               VALUES (?, ?, ?, ?, ?)""",
            (game_pk, locked_at, game_date, first_pitch, json.dumps(verdict)))


def locked_pks(game_pks: list[int]) -> set[int]:
    """Which of these already have a lock — one query, so the minute job does
    not hit the database once per game."""
    if not game_pks:
        return set()
    marks = ",".join("?" * len(game_pks))
    with get_db() as conn:
        return {r["game_pk"] for r in conn.execute(
            f"SELECT game_pk FROM favorite_verdicts WHERE game_pk IN ({marks})",
            game_pks)}
