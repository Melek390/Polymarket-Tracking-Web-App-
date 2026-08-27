"""Storage for the LoL scorecards.

Two tables:
  lol_team_stats  one row per (tournament, team) — the daily Oracle snapshot
  lol_scores      one row per Polymarket match — the scorecard, FROZEN once
                  the match starts so the number never moves under the client
                  (the same rule the MLB favorite verdict follows)
"""
import json

from backend.database.db import get_db

SCHEMA = """
CREATE TABLE IF NOT EXISTS lol_team_stats (
    tournament_id TEXT NOT NULL,
    team          TEXT NOT NULL,
    norm          TEXT NOT NULL,     -- normalised name, for matching
    core          TEXT NOT NULL DEFAULT '',  -- org words stripped, fallback
    games         INTEGER NOT NULL DEFAULT 0,
    last_game     TEXT,              -- tournament's mostRecentGame
    payload       TEXT NOT NULL,     -- the whole Oracle row, JSON
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    PRIMARY KEY (tournament_id, team)
);
CREATE INDEX IF NOT EXISTS idx_lol_stats_norm ON lol_team_stats(norm);
CREATE INDEX IF NOT EXISTS idx_lol_stats_core ON lol_team_stats(core);

CREATE TABLE IF NOT EXISTS lol_scores (
    event_slug  TEXT PRIMARY KEY,
    kickoff     TEXT,
    frozen      INTEGER NOT NULL DEFAULT 0,
    payload     TEXT NOT NULL,       -- the scorecard, JSON
    computed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
"""


def init() -> None:
    with get_db() as conn:
        conn.executescript(SCHEMA)
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(lol_team_stats)")]
        if "core" not in cols:      # added with the FURIA fix (Aug 27)
            conn.execute("ALTER TABLE lol_team_stats ADD COLUMN core TEXT "
                         "NOT NULL DEFAULT ''")


def norm(name: str) -> str:
    """'Gen.G' -> 'geng', 'G2 NORD' -> 'g2nord'. Name matching between
    Polymarket and Oracle is where these features break, so it is one
    function used by both sides."""
    return "".join(ch for ch in (name or "").lower() if ch.isalnum())


# Generic org words the two sources disagree about: Polymarket writes "FURIA
# Esports" and "Leviatan Esports" where Oracle writes "FURIA" and "Leviatan".
# Deliberately NOT stripped: academy, challengers, blue, star and the like —
# those name a DIFFERENT roster, and collapsing them would silently score the
# wrong team.
_ORG_WORDS = {"esports", "esport", "gaming", "club", "org"}


def core(name: str) -> str:
    """The name with generic org words removed, for the fallback match."""
    words = [w for w in "".join(
        ch if ch.isalnum() else " " for ch in (name or "").lower()).split()
        if w not in _ORG_WORDS]
    if len(words) > 1 and words[0] == "team":   # "Team Vitality" -> "vitality"
        words = words[1:]
    return "".join(words) or norm(name)


def save_team_stats(tournament_id: str, last_game: str | None,
                    rows: list[dict]) -> int:
    with get_db() as conn:
        conn.executemany(
            """INSERT INTO lol_team_stats
                   (tournament_id, team, norm, core, games, last_game,
                    payload, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
               ON CONFLICT(tournament_id, team) DO UPDATE SET
                   norm=excluded.norm, core=excluded.core, games=excluded.games,
                   last_game=excluded.last_game, payload=excluded.payload,
                   updated_at=excluded.updated_at""",
            [(tournament_id, r.get("Team") or r.get("id") or "",
              norm(r.get("Team") or r.get("id") or ""),
              core(r.get("Team") or r.get("id") or ""),
              int(r.get("GP") or 0), last_game, json.dumps(r))
             for r in rows if (r.get("Team") or r.get("id"))])
    return len(rows)


def lookup_team(name: str) -> list[dict]:
    """Every active tournament this team appears in, freshest first.

    Exact name first; only if nothing matches do we fall back to the
    org-word-stripped form, and then ONLY when it points at a single team —
    an ambiguous fallback is dropped rather than guessed at.
    """
    with get_db() as conn:
        rows = conn.execute(
            """SELECT tournament_id, team, games, last_game, payload
               FROM lol_team_stats WHERE norm = ?
               ORDER BY COALESCE(last_game,'') DESC, games DESC""",
            (norm(name),)).fetchall()
        if not rows:
            rows = conn.execute(
                """SELECT tournament_id, team, games, last_game, payload
                   FROM lol_team_stats WHERE core = ?
                   ORDER BY COALESCE(last_game,'') DESC, games DESC""",
                (core(name),)).fetchall()
            if len({r["team"] for r in rows}) > 1:
                return []           # ambiguous: two different orgs, no guess
    out = []
    for r in rows:
        try:
            stats = json.loads(r["payload"])
        except json.JSONDecodeError:
            continue
        out.append({"tournament_id": r["tournament_id"], "team": r["team"],
                    "games": r["games"], "last_game": r["last_game"],
                    "stats": stats})
    return out


def save_score(event_slug: str, kickoff: str | None, frozen: bool,
               payload: dict) -> None:
    with get_db() as conn:
        conn.execute(
            """INSERT INTO lol_scores (event_slug, kickoff, frozen, payload,
                                       computed_at)
               VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
               ON CONFLICT(event_slug) DO UPDATE SET
                   kickoff=excluded.kickoff, frozen=excluded.frozen,
                   payload=excluded.payload, computed_at=excluded.computed_at""",
            (event_slug, kickoff, 1 if frozen else 0, json.dumps(payload)))


def get_scores(slugs: list[str] | None = None) -> dict:
    with get_db() as conn:
        if slugs:
            marks = ",".join("?" * len(slugs))
            rows = conn.execute(
                f"SELECT * FROM lol_scores WHERE event_slug IN ({marks})",
                slugs).fetchall()
        else:
            rows = conn.execute("SELECT * FROM lol_scores").fetchall()
    out = {}
    for r in rows:
        try:
            payload = json.loads(r["payload"])
        except json.JSONDecodeError:
            continue
        payload["frozen"] = bool(r["frozen"])
        payload["computedAt"] = r["computed_at"]
        out[r["event_slug"]] = payload
    return out


def frozen_slugs() -> set:
    with get_db() as conn:
        return {r["event_slug"] for r in conn.execute(
            "SELECT event_slug FROM lol_scores WHERE frozen = 1")}
