"""Storage for the soccer 0-0 alert: triggers and configuration.

Same contract as the baseball Comeback Setup (the client asked for "just
like you do it for baseball"): every trigger is logged forever with its
full context, acknowledging stamps it without deleting anything, and every
threshold is editable from the UI without a deploy.
"""

import json
import time

from backend.database.db import get_db

SCHEMA = """
CREATE TABLE IF NOT EXISTS football_triggers (
    id         INTEGER PRIMARY KEY,
    fixture_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    ack_at     TEXT,
    outcome    TEXT,
    payload    TEXT NOT NULL          -- full context as JSON
);

-- fire ONCE per fixture: a match is 0-0 at the check minute exactly once
CREATE UNIQUE INDEX IF NOT EXISTS idx_football_once
    ON football_triggers(fixture_id);

CREATE TABLE IF NOT EXISTS football_config (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    payload TEXT NOT NULL
);
"""

# The client's spec, verbatim where it gives numbers.
DEFAULTS = {
    "enabled": True,
    # "pre-match odds of 60c or more in favor of one side"
    "min_favorite_cents": 60.0,
    # "match score is 0-0 at 60th minute"
    "min_minute": 60,
    # the red card display exists "to avoid situations where the pre-match
    # favorite is a man down" — this flag turns that from information into a
    # gate: suppress the alert when the favorite has a red card
    "skip_if_favorite_red_card": False,
}

_cfg_cache: tuple[float, dict] | None = None
_CFG_TTL = 30.0


def init():
    with get_db() as conn:
        conn.executescript(SCHEMA)


def config() -> dict:
    global _cfg_cache
    now = time.monotonic()
    if _cfg_cache and now - _cfg_cache[0] < _CFG_TTL:
        return _cfg_cache[1]
    with get_db() as conn:
        row = conn.execute("SELECT payload FROM football_config WHERE id=1").fetchone()
    cfg = dict(DEFAULTS)
    if row:
        try:
            saved = json.loads(row["payload"])
            cfg.update({k: v for k, v in saved.items() if k in DEFAULTS})
        except json.JSONDecodeError:
            pass
    _cfg_cache = (now, cfg)
    return cfg


def save_config(updates: dict) -> dict:
    """Merge validated updates; unknown keys refused (same rule as baseball)."""
    global _cfg_cache
    bad = [k for k in updates if k not in DEFAULTS]
    if bad:
        raise ValueError(f"unknown config keys: {', '.join(bad)}")
    cfg = dict(config())
    for k, v in updates.items():
        want = type(DEFAULTS[k])
        if want is bool:
            v = bool(v)
        elif want is int:
            v = int(v)
        elif want is float:
            v = float(v)
        cfg[k] = v
    with get_db() as conn:
        conn.execute(
            "INSERT INTO football_config (id, payload) VALUES (1, ?) "
            "ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
            (json.dumps(cfg),))
    _cfg_cache = None
    return cfg


def insert_trigger(fixture_id: int, payload: dict) -> bool:
    """-> True only when this fixture fired for the FIRST time."""
    with get_db() as conn:
        cur = conn.execute(
            "INSERT OR IGNORE INTO football_triggers (fixture_id, payload) "
            "VALUES (?, ?)", (fixture_id, json.dumps(payload)))
        return cur.rowcount == 1


def _row_dict(r) -> dict:
    try:
        p = json.loads(r["payload"])
    except json.JSONDecodeError:
        p = {}
    outcome = None
    if r["outcome"]:
        try:
            outcome = json.loads(r["outcome"])
        except json.JSONDecodeError:
            pass
    return {"id": r["id"], "fixture_id": r["fixture_id"],
            "created_at": r["created_at"], "ack_at": r["ack_at"],
            "outcome": outcome, **p}


def recent(hours: int = 24) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            """SELECT id, fixture_id, created_at, ack_at, outcome, payload
               FROM football_triggers
               WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?)
               ORDER BY created_at DESC""",
            (f"-{int(hours)} hours",)).fetchall()
    return [_row_dict(r) for r in rows]


def ack(trigger_id: int) -> bool:
    with get_db() as conn:
        cur = conn.execute(
            "UPDATE football_triggers SET ack_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') "
            "WHERE id=? AND ack_at IS NULL", (trigger_id,))
        return cur.rowcount == 1


def log(limit: int = 200) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            """SELECT id, fixture_id, created_at, ack_at, outcome, payload
               FROM football_triggers ORDER BY id DESC LIMIT ?""",
            (max(1, min(2000, limit)),)).fetchall()
    return [_row_dict(r) for r in rows]


def pending_outcomes(max_age_hours: int = 6) -> list[dict]:
    """Triggers still owed a final score; old ones age out (abandoned games)."""
    with get_db() as conn:
        rows = conn.execute(
            """SELECT id, fixture_id, created_at, ack_at, outcome, payload
               FROM football_triggers
               WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?)
                 AND outcome IS NULL
               ORDER BY id""",
            (f"-{int(max_age_hours)} hours",)).fetchall()
    return [_row_dict(r) for r in rows]


def save_outcome(trigger_id: int, outcome: dict):
    with get_db() as conn:
        conn.execute("UPDATE football_triggers SET outcome=? WHERE id=?",
                     (json.dumps(outcome), trigger_id))
