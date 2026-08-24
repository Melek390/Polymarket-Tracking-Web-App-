"""Storage for tracked trader accounts, their fills, and round-trip tags.

Fills are stored FOREVER with their maker/taker role and computed fee — the
API only reaches back 10,000 rows per wallet, so our own store is what
outlives that window (V3.md limitation 2)."""

import json

from backend.database.db import get_db

SCHEMA = """
CREATE TABLE IF NOT EXISTS trader_accounts (
    id         INTEGER PRIMARY KEY,
    wallet     TEXT NOT NULL,
    label      TEXT NOT NULL,
    -- which app user added it (users.id). NULL = added before accounts became
    -- per-user; those stay visible to everyone until claimed or deleted.
    owner_id   INTEGER,
    last_sync  TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE(wallet, owner_id)
);

CREATE TABLE IF NOT EXISTS trader_fills (
    id           INTEGER PRIMARY KEY,
    account_id   INTEGER NOT NULL REFERENCES trader_accounts(id),
    tx_hash      TEXT NOT NULL,
    asset        TEXT NOT NULL,
    condition_id TEXT NOT NULL,
    title        TEXT NOT NULL,
    slug         TEXT NOT NULL,
    event_slug   TEXT NOT NULL,
    outcome      TEXT NOT NULL,
    side         TEXT NOT NULL,               -- BUY | SELL
    price        REAL NOT NULL,               -- 0..1 as the API returns it
    size         REAL NOT NULL,               -- shares
    ts           INTEGER NOT NULL,            -- epoch seconds
    role         TEXT NOT NULL,               -- maker | taker
    fee          REAL NOT NULL                -- USDC, computed at ingest
);

-- the same fill can never be stored twice, which makes every re-sync a no-op
CREATE UNIQUE INDEX IF NOT EXISTS idx_trader_fills_unique
    ON trader_fills(account_id, tx_hash, asset, side, price, size);
CREATE INDEX IF NOT EXISTS idx_trader_fills_acct
    ON trader_fills(account_id, asset, ts);

-- tags sit on the ROUND TRIP: one (account, asset) position (V3.md, settled)
CREATE TABLE IF NOT EXISTS trader_tags (
    account_id INTEGER NOT NULL REFERENCES trader_accounts(id),
    asset      TEXT NOT NULL,
    tag        TEXT NOT NULL,
    PRIMARY KEY (account_id, asset, tag)
);

-- CLOB resolutions, persisted: a closed market can never un-close, and the
-- in-memory cache dying on every deploy caused ~200-market refetch storms
-- that hit rate limits and silently dropped resolved-zero losses (Aug 7)
CREATE TABLE IF NOT EXISTS trader_resolutions (
    condition_id TEXT PRIMARY KEY,
    winners      TEXT NOT NULL     -- JSON {outcome_lower: bool}
);
"""


def init() -> None:
    with get_db() as conn:
        conn.executescript(SCHEMA)
    # Aug 21 migration: accounts became per-user (the client and his brother
    # were seeing - and getting alerts for - each other's tracked wallets)
    if _needs_owner_migration():
        _migrate_owner_column()
    # Aug 24 migration: deletes became SOFT. Anyone could delete an unclaimed
    # shared account, and the delete hard-wiped its fill history for every
    # user (the client lost weeks of tracked data that way). A deleted row
    # now just hides; re-adding the wallet resurrects it with history intact.
    with get_db() as conn:
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(trader_accounts)")]
        if "deleted" not in cols:
            conn.execute("ALTER TABLE trader_accounts ADD COLUMN deleted "
                         "INTEGER NOT NULL DEFAULT 0")


def _needs_owner_migration() -> bool:
    with get_db() as conn:
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(trader_accounts)")]
    return "owner_id" not in cols


def _migrate_owner_column() -> None:
    """Rebuild trader_accounts with owner_id + UNIQUE(wallet, owner_id).

    trader_fills/trader_tags carry REFERENCES trader_accounts(id) and the app
    connection runs PRAGMA foreign_keys=ON, so DROP TABLE on the parent fails
    there (it crash-looped the service on first deploy). The rebuild therefore
    uses its OWN connection with foreign keys off — ids are preserved, so the
    references stay valid; RENAME then restores the referenced name."""
    import sqlite3
    from backend.config.settings import settings
    conn = sqlite3.connect(settings.db_path)   # fresh connection: FKs OFF
    try:
        conn.executescript("""
            -- a previous half-run may have left the staging table behind
            -- (the first deploy failed AFTER creating it); start clean
            DROP TABLE IF EXISTS trader_accounts_v2;
            CREATE TABLE trader_accounts_v2 (
                id         INTEGER PRIMARY KEY,
                wallet     TEXT NOT NULL,
                label      TEXT NOT NULL,
                owner_id   INTEGER,
                last_sync  TEXT,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
                UNIQUE(wallet, owner_id)
            );
            INSERT INTO trader_accounts_v2 (id, wallet, label, owner_id, last_sync, created_at)
                SELECT id, wallet, label, NULL, last_sync, created_at FROM trader_accounts;
            DROP TABLE trader_accounts;
            ALTER TABLE trader_accounts_v2 RENAME TO trader_accounts;
        """)
        conn.commit()
    finally:
        conn.close()


def list_accounts(owner_id: int | None = None) -> list[dict]:
    """owner_id given -> that user's accounts plus unclaimed legacy rows.
    None -> every account (the sync/resolution jobs, dev mode, healthcheck)."""
    with get_db() as conn:
        if owner_id is None:
            rows = conn.execute("SELECT * FROM trader_accounts WHERE deleted=0 ORDER BY id")
        else:
            rows = conn.execute(
                "SELECT * FROM trader_accounts WHERE deleted=0 "
                "AND (owner_id=? OR owner_id IS NULL) ORDER BY id", (owner_id,))
        return [dict(r) for r in rows]


def get_account(acct_id: int) -> dict | None:
    with get_db() as conn:
        r = conn.execute("SELECT * FROM trader_accounts WHERE id=? AND deleted=0",
                         (acct_id,)).fetchone()
        return dict(r) if r else None


def add_account(wallet: str, label: str, owner_id: int | None = None) -> dict:
    """Create the wallet under this owner. Re-adding a wallet that exists as
    an unclaimed legacy row CLAIMS that row instead of duplicating it, and
    re-adding a soft-deleted wallet RESURRECTS it - its fill history (which
    reaches beyond Polymarket's 10k-row API window) is the valuable part and
    must follow the account."""
    with get_db() as conn:
        if owner_id is not None:
            legacy = conn.execute(
                "SELECT id FROM trader_accounts WHERE wallet=? AND owner_id IS NULL "
                "AND deleted=0", (wallet,)).fetchone()
            if legacy:
                conn.execute("UPDATE trader_accounts SET owner_id=?, label=? WHERE id=?",
                             (owner_id, label, legacy["id"]))
                return dict(conn.execute("SELECT * FROM trader_accounts WHERE id=?",
                                         (legacy["id"],)).fetchone())
        # a deleted row for this wallet (any owner) comes back to life under
        # the new owner - the richest fill history first, nothing orphaned
        dead = conn.execute(
            "SELECT a.id FROM trader_accounts a "
            "LEFT JOIN trader_fills f ON f.account_id = a.id "
            "WHERE a.wallet=? AND a.deleted=1 "
            "GROUP BY a.id ORDER BY COUNT(f.id) DESC LIMIT 1",
            (wallet,)).fetchone()
        if dead:
            conn.execute("UPDATE trader_accounts SET deleted=0, owner_id=?, label=? "
                         "WHERE id=?", (owner_id, label, dead["id"]))
            return dict(conn.execute("SELECT * FROM trader_accounts WHERE id=?",
                                     (dead["id"],)).fetchone())
        conn.execute(
            "INSERT OR IGNORE INTO trader_accounts (wallet, label, owner_id) VALUES (?, ?, ?)",
            (wallet, label, owner_id))
        r = conn.execute(
            "SELECT * FROM trader_accounts WHERE wallet=? AND owner_id IS ? AND deleted=0",
            (wallet, owner_id)).fetchone()
        return dict(r)


def delete_account(acct_id: int) -> None:
    """SOFT delete: the row hides from every list but its fills and tags
    stay. Re-adding the same wallet resurrects everything. The old hard
    delete destroyed weeks of shared fill history in one click (Aug 24)."""
    with get_db() as conn:
        conn.execute("UPDATE trader_accounts SET deleted=1 WHERE id=?", (acct_id,))


def touch_sync(acct_id: int) -> None:
    with get_db() as conn:
        conn.execute(
            "UPDATE trader_accounts SET last_sync=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?",
            (acct_id,))


def insert_fills(acct_id: int, fills: list[dict]) -> int:
    """INSERT OR IGNORE — the unique index makes re-syncs idempotent."""
    with get_db() as conn:
        cur = conn.executemany(
            """INSERT OR IGNORE INTO trader_fills
               (account_id, tx_hash, asset, condition_id, title, slug,
                event_slug, outcome, side, price, size, ts, role, fee)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            [(acct_id, f["tx"], f["asset"], f["condition_id"], f["title"],
              f["slug"], f["event_slug"], f["outcome"], f["side"], f["price"],
              f["size"], f["ts"], f["role"], f["fee"]) for f in fills])
        return cur.rowcount


def update_fees(acct_id: int, fills: list[dict]) -> None:
    """Re-stamp fees on already-stored fills — sync self-heals rows that were
    ingested under the (wrong) flat schedule before exact fees existed."""
    with get_db() as conn:
        conn.executemany(
            """UPDATE trader_fills SET fee=?
               WHERE account_id=? AND tx_hash=? AND asset=? AND side=?
                 AND price=? AND size=? AND ABS(fee - ?) > 1e-9""",
            [(f["fee"], acct_id, f["tx"], f["asset"], f["side"],
              f["price"], f["size"], f["fee"]) for f in fills])


def fills_for(acct_id: int) -> list[dict]:
    with get_db() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT * FROM trader_fills WHERE account_id=? ORDER BY ts, id",
            (acct_id,))]


def saved_resolutions(condition_ids: list[str]) -> dict[str, dict]:
    """Stored CLOSED resolutions for these markets ({} for none). Only closed
    markets are ever written, so a hit is final — no TTL, survives restarts."""
    out = {}
    if not condition_ids:
        return out
    with get_db() as conn:
        for chunk_start in range(0, len(condition_ids), 500):
            chunk = condition_ids[chunk_start:chunk_start + 500]
            q = ",".join("?" * len(chunk))
            for r in conn.execute(
                    f"SELECT condition_id, winners FROM trader_resolutions WHERE condition_id IN ({q})",
                    chunk):
                out[r["condition_id"]] = {"closed": True,
                                          "winners": json.loads(r["winners"])}
    return out


def save_resolution(condition_id: str, winners: dict) -> None:
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO trader_resolutions (condition_id, winners) VALUES (?, ?)",
            (condition_id, json.dumps(winners)))


def volume_for(acct_id: int) -> dict:
    """Lifetime traded volume — the number fees are actually a percentage of.
    Shown beside the fee card so "34% of my profit!?" reads as the ~1.3% of
    turnover it really is."""
    with get_db() as conn:
        r = conn.execute(
            """SELECT COUNT(*) AS fills,
                      COALESCE(SUM(price * size), 0) AS volume,
                      COALESCE(SUM(CASE WHEN role='taker' THEN price * size END), 0) AS taker_volume,
                      COALESCE(SUM(fee), 0) AS fees
               FROM trader_fills WHERE account_id=?""", (acct_id,)).fetchone()
        return {"fills": r["fills"], "volume": r["volume"],
                "taker_volume": r["taker_volume"], "fees": r["fees"]}


def tags_for(acct_id: int) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    with get_db() as conn:
        for r in conn.execute(
                "SELECT asset, tag FROM trader_tags WHERE account_id=? ORDER BY tag",
                (acct_id,)):
            out.setdefault(r["asset"], []).append(r["tag"])
    return out


def toggle_tag(acct_id: int, asset: str, tag: str) -> bool:
    """Add the tag if absent, remove it if present. Returns True when added."""
    with get_db() as conn:
        gone = conn.execute(
            "DELETE FROM trader_tags WHERE account_id=? AND asset=? AND tag=?",
            (acct_id, asset, tag)).rowcount
        if gone:
            return False
        conn.execute(
            "INSERT INTO trader_tags (account_id, asset, tag) VALUES (?,?,?)",
            (acct_id, asset, tag))
        return True


def all_tags(acct_id: int) -> list[str]:
    """Every distinct tag this account has ever used — the custom vocabulary
    shown alongside the fixed list (client item 6)."""
    with get_db() as conn:
        return [r["tag"] for r in conn.execute(
            "SELECT DISTINCT tag FROM trader_tags WHERE account_id=? ORDER BY tag",
            (acct_id,))]
