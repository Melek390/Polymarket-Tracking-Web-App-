"""SQLite storage: schema, connection helper, and all queries."""

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

from backend.config.settings import settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY,
    slug       TEXT UNIQUE NOT NULL,
    title      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS markets (
    id            INTEGER PRIMARY KEY,
    event_id      INTEGER NOT NULL REFERENCES events(id),
    condition_id  TEXT UNIQUE NOT NULL,
    question      TEXT NOT NULL,
    kind          TEXT NOT NULL,              -- yes_no | team | wdl | totals
    tracking      INTEGER NOT NULL DEFAULT 0,
    poll_interval INTEGER NOT NULL DEFAULT 5, -- seconds
    closed        INTEGER NOT NULL DEFAULT 0, -- resolved on Polymarket, no more data
    closed_at     TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS outcomes (
    id        INTEGER PRIMARY KEY,
    market_id INTEGER NOT NULL REFERENCES markets(id),
    label     TEXT NOT NULL,
    token_id  TEXT UNIQUE NOT NULL,           -- CLOB token id
    position  INTEGER NOT NULL                -- display order / color index
);

CREATE TABLE IF NOT EXISTS ticks (
    id         INTEGER PRIMARY KEY,
    outcome_id INTEGER NOT NULL REFERENCES outcomes(id),
    ts         TEXT NOT NULL,                 -- ISO-8601 UTC, set at poll time
    price      REAL NOT NULL                  -- midpoint in cents, 0..100
);

-- UNIQUE: the same outcome can never store two prices for one timestamp,
-- which makes live polling and history backfill collision-proof by design.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticks_outcome_ts ON ticks(outcome_id, ts);

-- lets "latest tick" and "records today" use an index instead of scanning
-- the whole table, which was taking seconds once the db passed a few hundred MB
CREATE INDEX IF NOT EXISTS idx_ticks_ts ON ticks(ts);

-- running per-outcome totals so record counts never re-count millions of rows
CREATE TABLE IF NOT EXISTS tick_counts (
    outcome_id INTEGER PRIMARY KEY,
    n          INTEGER NOT NULL
);

-- Screener cache: one row per upcoming match, rebuilt by a background job
-- so the screener page filters instantly instead of hitting Gamma live.
-- Every slug prefix ever seen per sport, learned from the screener cache on
-- each refresh. The accounts tracker uses it to categorise positions: slug
-- prefixes like lal-/dfb-/scop- are Polymarket inventions that appear and
-- disappear with the calendar, so a hardcoded list in the frontend went
-- stale (a Real Madrid position showed as "Other"). Rows accumulate — a
-- league out of season keeps its mapping.
CREATE TABLE IF NOT EXISTS slug_prefixes (
    prefix    TEXT PRIMARY KEY,
    sport     TEXT NOT NULL,
    last_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS screener_cache (
    event_slug    TEXT PRIMARY KEY,
    sport         TEXT NOT NULL,
    league        TEXT NOT NULL,
    home_team     TEXT NOT NULL,
    away_team     TEXT NOT NULL,
    kickoff       TEXT,                      -- ISO-8601 UTC, NULL if unknown
    volume        REAL NOT NULL DEFAULT 0,   -- lifetime USD volume
    home_price    REAL,                      -- cents, NULL when not quoted
    draw_price    REAL,
    away_price    REAL,
    condition_ids TEXT NOT NULL,             -- JSON list, used by Track
    game_pk       INTEGER,                   -- MLB gamePk for baseball live data
    token_ids     TEXT,                      -- JSON [home, away] CLOB tokens for live prices
    updated_at    TEXT NOT NULL
);

-- Resolved Polymarket-slug -> MLB gamePk pairs, so the accounts tracker can
-- deep-link a position to MLB.com. The screener only keeps CURRENT games, and
-- a position can be months old, so resolving one costs an MLB schedule call —
-- worth remembering permanently (a finished game's pk never changes). Only
-- SUCCESSFUL matches are stored: caching a miss during an MLB outage would
-- make the gap permanent.
CREATE TABLE IF NOT EXISTS mlb_game_pks (
    event_slug  TEXT PRIMARY KEY,
    game_pk     INTEGER NOT NULL,
    resolved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
"""


@contextmanager
def get_db():
    """Open a WAL-mode connection that commits on success and always closes."""
    conn = sqlite3.connect(settings.db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    """Create the tables on first run; safe to call at every startup."""
    with get_db() as conn:
        conn.executescript(SCHEMA)
        # migrate databases created before the closed-market feature
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(markets)")]
        if "closed" not in cols:
            conn.execute("ALTER TABLE markets ADD COLUMN closed INTEGER NOT NULL DEFAULT 0")
            conn.execute("ALTER TABLE markets ADD COLUMN closed_at TEXT")

        # one-time migration: prices moved from 0..1 fractions to cents.
        # user_version guards it so it can never run twice.
        if conn.execute("PRAGMA user_version").fetchone()[0] < 1:
            conn.execute("UPDATE ticks SET price = ROUND(price * 100, 2)")
            conn.execute("PRAGMA user_version = 1")

        # add newer columns to older screener caches
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(events)")]
        if cols and "category" not in cols:
            conn.execute("ALTER TABLE events ADD COLUMN category TEXT")

        cols = [r["name"] for r in conn.execute("PRAGMA table_info(screener_cache)")]
        if cols and "game_pk" not in cols:
            conn.execute("ALTER TABLE screener_cache ADD COLUMN game_pk INTEGER")
        if cols and "token_ids" not in cols:
            conn.execute("ALTER TABLE screener_cache ADD COLUMN token_ids TEXT")

        # one-time: seed the running totals from the existing ticks
        if conn.execute("PRAGMA user_version").fetchone()[0] < 2:
            conn.execute("DELETE FROM tick_counts")
            conn.execute(
                "INSERT INTO tick_counts (outcome_id, n) "
                "SELECT outcome_id, COUNT(*) FROM ticks GROUP BY outcome_id"
            )
            conn.execute("PRAGMA user_version = 2")


# --- writes ----------------------------------------------------------------

def upsert_event(slug: str, title: str, category: str | None = None) -> int:
    """Insert an event (or refresh its title/category) and return its id."""
    with get_db() as conn:
        conn.execute(
            "INSERT INTO events (slug, title, category) VALUES (?, ?, ?) "
            "ON CONFLICT(slug) DO UPDATE SET title = excluded.title, "
            "category = COALESCE(excluded.category, events.category)",
            (slug, title, category),
        )
        return conn.execute(
            "SELECT id FROM events WHERE slug = ?", (slug,)
        ).fetchone()["id"]


def add_market(
    event_id: int,
    condition_id: str,
    question: str,
    kind: str,
    outcomes: list[dict],
    poll_interval: int | None = None,
) -> int:
    """Save a market with tracking on; re-adding a known market resumes its polling."""
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id, closed FROM markets WHERE condition_id = ?", (condition_id,)
        ).fetchone()
        if existing:
            if not existing["closed"]:
                conn.execute(
                    "UPDATE markets SET tracking = 1 WHERE id = ?", (existing["id"],)
                )
            return existing["id"]

        cur = conn.execute(
            "INSERT INTO markets (event_id, condition_id, question, kind, tracking, poll_interval) "
            "VALUES (?, ?, ?, ?, 1, ?)",
            (event_id, condition_id, question, kind,
             poll_interval or settings.default_poll_interval),
        )
        market_id = cur.lastrowid
        conn.executemany(
            "INSERT INTO outcomes (market_id, label, token_id, position) VALUES (?, ?, ?, ?)",
            [(market_id, o["label"], o["token_id"], i) for i, o in enumerate(outcomes)],
        )
        return market_id


def set_closed(market_id: int, closed_at: str):
    """Mark a market as resolved on Polymarket and stop its polling."""
    with get_db() as conn:
        conn.execute(
            "UPDATE markets SET closed = 1, closed_at = ?, tracking = 0 WHERE id = ?",
            (closed_at, market_id),
        )


def set_tracking(market_id: int, tracking: bool):
    """Turn polling on or off for one market."""
    with get_db() as conn:
        conn.execute(
            "UPDATE markets SET tracking = ? WHERE id = ?",
            (1 if tracking else 0, market_id),
        )


def upsert_slug_prefixes(sport: str, slugs: list[str]) -> None:
    pairs = {s.split("-")[0].lower() for s in slugs if s and "-" in s}
    if not pairs:
        return
    with get_db() as conn:
        conn.executemany(
            "INSERT INTO slug_prefixes (prefix, sport) VALUES (?, ?) "
            "ON CONFLICT(prefix) DO UPDATE SET sport=excluded.sport, "
            "last_seen=strftime('%Y-%m-%dT%H:%M:%SZ','now')",
            [(p, sport) for p in pairs])


def slug_prefix_map() -> dict[str, str]:
    with get_db() as conn:
        return {r["prefix"]: r["sport"] for r in
                conn.execute("SELECT prefix, sport FROM slug_prefixes")}


def screener_game_pk(slug: str) -> int | None:
    """The gamePk the screener already matched to this event. The screener
    matches on full team names (which agree with MLB exactly), so this is more
    reliable than re-deriving it from the slug's abbreviations."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT game_pk FROM screener_cache WHERE event_slug = ? AND game_pk IS NOT NULL",
            (slug.replace("-more-markets", ""),),
        ).fetchone()
        return row["game_pk"] if row else None


def mlb_game_pks(slugs: list[str]) -> dict[str, int]:
    """Cached slug -> gamePk for the slugs asked about (misses simply absent)."""
    if not slugs:
        return {}
    marks = ",".join("?" * len(slugs))
    with get_db() as conn:
        return {r["event_slug"]: r["game_pk"] for r in conn.execute(
            f"SELECT event_slug, game_pk FROM mlb_game_pks WHERE event_slug IN ({marks})",
            slugs)}


def save_mlb_game_pk(slug: str, game_pk: int) -> None:
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO mlb_game_pks (event_slug, game_pk) VALUES (?, ?)",
            (slug, game_pk))


def closed_among(market_ids: list[int]) -> list[int]:
    """Which of these markets Polymarket has already resolved. Re-tracking one
    is a no-op, so the UI needs to say so instead of silently doing nothing."""
    if not market_ids:
        return []
    placeholders = ",".join("?" * len(market_ids))
    with get_db() as conn:
        rows = conn.execute(
            f"SELECT id FROM markets WHERE closed = 1 AND id IN ({placeholders})",
            market_ids,
        ).fetchall()
        return [r["id"] for r in rows]


def mlb_tracked_markets() -> list[dict]:
    """Open, tracked MLB markets with their slug — the collector uses these to
    poll a game fast only while it is actually in progress."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT m.id, m.poll_interval, e.slug FROM markets m "
            "JOIN events e ON m.event_id = e.id "
            "WHERE m.tracking = 1 AND m.closed = 0 AND e.slug LIKE 'mlb-%'"
        ).fetchall()
        return [dict(r) for r in rows]


def set_poll_interval(market_id: int, seconds: int):
    """Change how often a market gets polled."""
    with get_db() as conn:
        conn.execute(
            "UPDATE markets SET poll_interval = ? WHERE id = ?",
            (seconds, market_id),
        )


def delete_market(market_id: int):
    """Permanently remove a market with all its outcomes and ticks."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT event_id FROM markets WHERE id = ?", (market_id,)
        ).fetchone()
        if not row:
            return
        conn.execute(
            "DELETE FROM ticks WHERE outcome_id IN "
            "(SELECT id FROM outcomes WHERE market_id = ?)",
            (market_id,),
        )
        conn.execute(
            "DELETE FROM tick_counts WHERE outcome_id IN "
            "(SELECT id FROM outcomes WHERE market_id = ?)",
            (market_id,),
        )
        conn.execute("DELETE FROM outcomes WHERE market_id = ?", (market_id,))
        conn.execute("DELETE FROM markets WHERE id = ?", (market_id,))
        # drop the event too once its last market is gone
        conn.execute(
            "DELETE FROM events WHERE id = ? AND NOT EXISTS "
            "(SELECT 1 FROM markets WHERE event_id = ?)",
            (row["event_id"], row["event_id"]),
        )
    # fold the purge out of the write-ahead log so a big delete does not
    # leave hundreds of MB sitting in the -wal file
    with get_db() as conn:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")


def insert_ticks(rows: list[tuple]):
    """Store one poll cycle and keep the per-outcome running totals in step."""
    with get_db() as conn:
        by_outcome: dict[int, list[tuple]] = {}
        for row in rows:
            by_outcome.setdefault(row[0], []).append(row)
        for outcome_id, group in by_outcome.items():
            cur = conn.executemany(
                "INSERT OR IGNORE INTO ticks (outcome_id, ts, price) VALUES (?, ?, ?)",
                group,
            )
            # rowcount counts what was really inserted, so ignored
            # duplicates never inflate the totals
            if cur.rowcount > 0:
                conn.execute(
                    "INSERT INTO tick_counts (outcome_id, n) VALUES (?, ?) "
                    "ON CONFLICT(outcome_id) DO UPDATE SET n = n + excluded.n",
                    (outcome_id, cur.rowcount),
                )


def replace_screener_cache(sport: str, rows: list[dict]):
    """Swap one sport's cached matches for a freshly fetched set, atomically."""
    with get_db() as conn:
        conn.execute("DELETE FROM screener_cache WHERE sport = ?", (sport,))
        conn.executemany(
            "INSERT OR REPLACE INTO screener_cache "
            "(event_slug, sport, league, home_team, away_team, kickoff, volume, "
            " home_price, draw_price, away_price, condition_ids, game_pk, "
            " token_ids, updated_at) "
            "VALUES (:event_slug, :sport, :league, :home_team, :away_team, "
            " :kickoff, :volume, :home_price, :draw_price, :away_price, "
            " :condition_ids, :game_pk, :token_ids, :updated_at)",
            rows,
        )


def screener_token_ids(slug: str) -> list | None:
    """The [home, away] CLOB token ids for one cached row, for live pricing."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT token_ids FROM screener_cache WHERE event_slug = ?", (slug,)
        ).fetchone()
    if not row or not row["token_ids"]:
        return None
    return json.loads(row["token_ids"])


def live_screener_tokens() -> list[dict]:
    """(event_slug, token_ids) for every cached row that has CLOB tokens,
    across all sports — the live-price poller filters these to the games
    actually being viewed."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT event_slug, token_ids FROM screener_cache "
            "WHERE token_ids IS NOT NULL"
        ).fetchall()
        return [dict(r) for r in rows]


def screener_rows(sport: str) -> list[dict]:
    """All cached matches for one sport, soonest kickoff first."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM screener_cache WHERE sport = ? "
            "ORDER BY kickoff IS NULL, kickoff",
            (sport,),
        ).fetchall()
        return [dict(r) for r in rows]


# --- reads -----------------------------------------------------------------

def tracked_outcomes() -> list[dict]:
    """List every outcome the collector should be polling right now."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT o.id AS outcome_id, o.token_id, m.id AS market_id, m.poll_interval "
            "FROM outcomes o JOIN markets m ON o.market_id = m.id "
            "WHERE m.tracking = 1"
        ).fetchall()
        return [dict(r) for r in rows]


def get_market(market_id: int) -> dict | None:
    """One market with its event info and outcomes, or None if unknown."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT m.*, e.title AS event_title, e.slug AS event_slug "
            "FROM markets m JOIN events e ON m.event_id = e.id WHERE m.id = ?",
            (market_id,),
        ).fetchone()
        if not row:
            return None
        market = dict(row)
        market["outcomes"] = [
            dict(o)
            for o in conn.execute(
                "SELECT id, label, token_id, position FROM outcomes "
                "WHERE market_id = ? ORDER BY position",
                (market_id,),
            )
        ]
        return market


def list_markets(spark_points: int = 20) -> list[dict]:
    """All markets with their outcomes, record counts and sparkline points."""
    with get_db() as conn:
        markets = [
            dict(r)
            for r in conn.execute(
                "SELECT m.*, e.title AS event_title, e.slug AS event_slug, "
                "e.category AS category "
                "FROM markets m JOIN events e ON m.event_id = e.id ORDER BY m.id"
            )
        ]
        for m in markets:
            m["outcomes"] = [
                dict(o)
                for o in conn.execute(
                    "SELECT id, label, token_id, position FROM outcomes "
                    "WHERE market_id = ? ORDER BY position",
                    (m["id"],),
                )
            ]
            m["records"] = conn.execute(
                "SELECT COALESCE(SUM(n), 0) AS n FROM tick_counts "
                "WHERE outcome_id IN (SELECT id FROM outcomes WHERE market_id = ?)",
                (m["id"],),
            ).fetchone()["n"]
            # per-outcome MAX is an index seek, so this stays fast at any size
            last = None
            for o in m["outcomes"]:
                t = conn.execute(
                    "SELECT MAX(ts) AS t FROM ticks WHERE outcome_id = ?",
                    (o["id"],),
                ).fetchone()["t"]
                if t and (last is None or t > last):
                    last = t
            m["last_update"] = last
            if m["outcomes"]:
                spark = conn.execute(
                    "SELECT price FROM ticks WHERE outcome_id = ? "
                    "ORDER BY ts DESC LIMIT ?",
                    (m["outcomes"][0]["id"], spark_points),
                ).fetchall()
                m["spark"] = [r["price"] for r in reversed(spark)]
            else:
                m["spark"] = []
        return markets


def _ts_seconds(ts: str) -> int:
    """Epoch seconds from our stored 2026-07-31T21:04:09Z format."""
    try:
        return int(datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ")
                   .replace(tzinfo=timezone.utc).timestamp())
    except (ValueError, TypeError):
        return 0


def get_ticks(market_id: int, limit: int = 500, before: str | None = None) -> list[dict]:
    """Time-series rows for one market, one dict per poll, oldest first."""
    with get_db() as conn:
        labels = {
            o["id"]: o["label"]
            for o in conn.execute(
                "SELECT id, label FROM outcomes WHERE market_id = ? ORDER BY position",
                (market_id,),
            )
        }
        if not labels:
            return []

        placeholders = ",".join("?" * len(labels))
        params: list = list(labels)
        where = f"outcome_id IN ({placeholders})"
        if before:
            where += " AND ts < ?"
            params.append(before)

        rows = conn.execute(
            f"SELECT outcome_id, ts, price FROM ticks WHERE {where} "
            f"ORDER BY ts DESC LIMIT ?",
            params + [limit * len(labels)],
        ).fetchall()

        by_ts: dict[str, dict] = {}
        for r in rows:
            by_ts.setdefault(r["ts"], {})[r["outcome_id"]] = r["price"]

        # Backfilled history stores each outcome a second or two apart, which
        # left every row holding only one side's price — the chart then drew
        # each series as disconnected fragments. Fold a row into the previous
        # one when it is within MERGE_SECONDS and adds outcomes that row is
        # missing (live polls already share one timestamp, so they are
        # unaffected).
        MERGE_SECONDS = 2
        merged: list[tuple[str, dict]] = []
        for ts, prices in sorted(by_ts.items()):
            if merged:
                prev_ts, prev_prices = merged[-1]
                close = (_ts_seconds(ts) - _ts_seconds(prev_ts)) <= MERGE_SECONDS
                if close and not (prices.keys() & prev_prices.keys()):
                    prev_prices.update(prices)
                    continue
            merged.append((ts, dict(prices)))

        return [
            {
                "ts": ts,
                "prices": {
                    label: prices[oid] for oid, label in labels.items() if oid in prices
                },
            }
            for ts, prices in merged
        ]


def get_chart(market_id: int, points: int = 1500) -> list[dict]:
    """The ENTIRE price history downsampled to ~points rows (client, Aug 11:
    the chart must show a market's whole life — V1 promised that for closed
    markets and the newest-2000 cap silently broke it). Prices are averaged
    per time bucket; the caller overlays raw recent ticks for fine detail."""
    with get_db() as conn:
        labels = {
            o["id"]: o["label"]
            for o in conn.execute(
                "SELECT id, label FROM outcomes WHERE market_id = ? ORDER BY position",
                (market_id,),
            )
        }
        if not labels:
            return []
        placeholders = ",".join("?" * len(labels))
        span = conn.execute(
            f"SELECT CAST(strftime('%s', MIN(ts)) AS INTEGER),"
            f"       CAST(strftime('%s', MAX(ts)) AS INTEGER)"
            f" FROM ticks WHERE outcome_id IN ({placeholders})",
            list(labels)).fetchone()
        if not span or span[0] is None:
            return []
        t0, t1 = span
        width = max(1, (t1 - t0) // max(1, points))
        # min AND max per bucket, not the mean: averaging painted prices that
        # never traded once a game swung hard inside one bucket (client caught
        # "59.76¢" on a bucket that really ran 40¢ -> 80¢, Aug 11). Flat
        # buckets emit one point; volatile ones emit their true extremes.
        rows = conn.execute(
            f"""SELECT outcome_id,
                       (CAST(strftime('%s', ts) AS INTEGER) - ?) / ? AS bucket,
                       MIN(price) AS lo, MAX(price) AS hi
                FROM ticks WHERE outcome_id IN ({placeholders})
                GROUP BY outcome_id, bucket ORDER BY bucket""",
            [t0, width, *labels]).fetchall()
        lows: dict[int, dict] = {}
        highs: dict[int, dict] = {}
        for r in rows:
            lows.setdefault(r["bucket"], {})[r["outcome_id"]] = round(r["lo"], 2)
            highs.setdefault(r["bucket"], {})[r["outcome_id"]] = round(r["hi"], 2)

        def _stamp(sec: int) -> str:
            return datetime.fromtimestamp(sec, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        out = []
        for b in sorted(lows):
            lo, hi = lows[b], highs[b]
            if lo == hi:  # quiet bucket — one point carries it
                out.append({"ts": _stamp(t0 + b * width + width // 2), "prices": {
                    label: lo[oid] for oid, label in labels.items() if oid in lo}})
                continue
            out.append({"ts": _stamp(t0 + b * width + width // 3), "prices": {
                label: lo[oid] for oid, label in labels.items() if oid in lo}})
            out.append({"ts": _stamp(t0 + b * width + 2 * width // 3), "prices": {
                label: hi[oid] for oid, label in labels.items() if oid in hi}})
        return out


def iter_ticks(market_id: int):
    """Walk the full history chronologically without loading it all into memory."""
    with get_db() as conn:
        labels = {
            o["id"]: o["label"]
            for o in conn.execute(
                "SELECT id, label FROM outcomes WHERE market_id = ? ORDER BY position",
                (market_id,),
            )
        }
        if not labels:
            return

        placeholders = ",".join("?" * len(labels))
        cursor = conn.execute(
            f"SELECT outcome_id, ts, price FROM ticks "
            f"WHERE outcome_id IN ({placeholders}) ORDER BY ts",
            list(labels),
        )
        ts, prices = None, {}
        for r in cursor:
            if r["ts"] != ts:
                if ts is not None:
                    yield ts, prices
                ts, prices = r["ts"], {}
            prices[labels[r["outcome_id"]]] = r["price"]
        if ts is not None:
            yield ts, prices


def dashboard_stats() -> dict:
    """Counts, freshness and database size for the dashboard cards."""
    with get_db() as conn:
        counts = conn.execute(
            "SELECT COUNT(*) AS total, COALESCE(SUM(tracking), 0) AS active FROM markets"
        ).fetchone()
        # both use the ts index: an instant MAX and a scan of today's rows only
        last_update = conn.execute("SELECT MAX(ts) AS t FROM ticks").fetchone()["t"]
        records_today = conn.execute(
            "SELECT COUNT(*) AS n FROM ticks WHERE ts >= datetime('now', 'start of day')"
        ).fetchone()["n"]

        # live data size: pages in use, so the number drops as soon as
        # something is deleted (the file itself only shrinks on VACUUM)
        page_size = conn.execute("PRAGMA page_size").fetchone()[0]
        page_count = conn.execute("PRAGMA page_count").fetchone()[0]
        freelist = conn.execute("PRAGMA freelist_count").fetchone()[0]
        size = (page_count - freelist) * page_size

    return {
        "active": counts["active"],
        "total": counts["total"],
        "db_size_bytes": size,
        "last_update": last_update,
        "records_today": records_today,
    }
