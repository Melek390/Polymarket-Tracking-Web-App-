"""Storage for Comeback Setup triggers and their configuration.

Every trigger is logged FOREVER with its full context (score, inning, the
pitcher, why he counted as tired, the Polymarket prices at that moment) — the
client wants to review later how often the signal was right, and to feed it
to backtesting. Acknowledging a trigger stamps it; it is never deleted.

Config lives in one JSON row so the thresholds are editable from the UI
without a deploy — the client asked for every threshold to be configurable.
"""

import json
import time

from backend.database.db import get_db

SCHEMA = """
CREATE TABLE IF NOT EXISTS comeback_triggers (
    id         INTEGER PRIMARY KEY,
    game_pk    INTEGER NOT NULL,
    pitcher_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    ack_at     TEXT,
    payload    TEXT NOT NULL          -- full context as JSON
);

-- fire ONCE per pitcher per game: the guard that makes repeat polls no-ops.
-- A SECOND pitching change in the same game that also meets the criteria is
-- its own row — it is genuinely a new situation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_comeback_once
    ON comeback_triggers(game_pk, pitcher_id);

CREATE TABLE IF NOT EXISTS comeback_config (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    payload TEXT NOT NULL
);
"""

# The client's spec, verbatim where it gives numbers. Every key is editable
# from the UI; unknown keys in a PUT are rejected rather than stored.
DEFAULTS = {
    "enabled": True,
    # "Inning >= 7 (default; preferably >= 8) ... I want after top 8th is
    # finished and bottom 8 starts" -> default 8, changeable to 7 or 9
    "min_inning": 8,
    # home batting or about to bat (the Middle break counts: pitching changes
    # are announced during the break, before the bottom formally starts)
    "require_bottom": True,
    # home trailing by exactly 1 — and, added Aug 13, tied counts too
    "allow_tied": True,
    # quality filters: the new pitcher must meet at least `quality_min` of the
    # three checks; require_consecutive_days upgrades that one check from
    # "counts toward the minimum" to "mandatory"
    "quality_min": 1,
    "require_consecutive_days": False,
    "whip_threshold": 1.35,
    "whip_apps": 10,          # recent WHIP window: last 8-15 appearances
    "prev_pitches": 25,       # high pitch count in the previous outing
}

_cfg_cache: tuple[float, dict] | None = None
_CFG_TTL = 30.0


def init():
    with get_db() as conn:
        conn.executescript(SCHEMA)


def config() -> dict:
    """Current config: defaults overlaid with whatever the UI saved. Cached a
    few seconds so the 10s detector isn't a DB read per tick."""
    global _cfg_cache
    now = time.monotonic()
    if _cfg_cache and now - _cfg_cache[0] < _CFG_TTL:
        return _cfg_cache[1]
    with get_db() as conn:
        row = conn.execute("SELECT payload FROM comeback_config WHERE id=1").fetchone()
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
    """Merge validated updates into the stored config. Unknown keys refused."""
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
            "INSERT INTO comeback_config (id, payload) VALUES (1, ?) "
            "ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
            (json.dumps(cfg),))
    _cfg_cache = None
    return cfg


def insert_trigger(game_pk: int, pitcher_id: int, payload: dict) -> bool:
    """-> True only when this (game, pitcher) fired for the FIRST time."""
    with get_db() as conn:
        cur = conn.execute(
            "INSERT OR IGNORE INTO comeback_triggers (game_pk, pitcher_id, payload) "
            "VALUES (?, ?, ?)",
            (game_pk, pitcher_id, json.dumps(payload)))
        return cur.rowcount == 1


def recent(hours: int = 24) -> list[dict]:
    """Today's triggers, acked or not — the UI keeps a quiet tag on acked ones
    for the rest of the day so 'did it fire earlier?' has an answer."""
    with get_db() as conn:
        rows = conn.execute(
            """SELECT id, game_pk, pitcher_id, created_at, ack_at, payload
               FROM comeback_triggers
               WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?)
               ORDER BY created_at DESC""",
            (f"-{int(hours)} hours",)).fetchall()
    out = []
    for r in rows:
        try:
            p = json.loads(r["payload"])
        except json.JSONDecodeError:
            p = {}
        out.append({"id": r["id"], "game_pk": r["game_pk"],
                    "pitcher_id": r["pitcher_id"], "created_at": r["created_at"],
                    "ack_at": r["ack_at"], **p})
    return out


def ack(trigger_id: int) -> bool:
    with get_db() as conn:
        cur = conn.execute(
            "UPDATE comeback_triggers SET ack_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') "
            "WHERE id=? AND ack_at IS NULL", (trigger_id,))
        return cur.rowcount == 1


def log(limit: int = 200) -> list[dict]:
    """The full history, newest first — the review/backtest export."""
    with get_db() as conn:
        rows = conn.execute(
            """SELECT id, game_pk, pitcher_id, created_at, ack_at, payload
               FROM comeback_triggers ORDER BY id DESC LIMIT ?""",
            (max(1, min(2000, limit)),)).fetchall()
    out = []
    for r in rows:
        try:
            p = json.loads(r["payload"])
        except json.JSONDecodeError:
            p = {}
        out.append({"id": r["id"], "game_pk": r["game_pk"],
                    "pitcher_id": r["pitcher_id"], "created_at": r["created_at"],
                    "ack_at": r["ack_at"], **p})
    return out
