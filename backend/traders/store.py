"""Storage for tracked trader accounts, their fills, and round-trip tags.

Fills are stored FOREVER with their maker/taker role and computed fee — the
API only reaches back 10,000 rows per wallet, so our own store is what
outlives that window (V3.md limitation 2)."""

from backend.database.db import get_db

SCHEMA = """
CREATE TABLE IF NOT EXISTS trader_accounts (
    id         INTEGER PRIMARY KEY,
    wallet     TEXT UNIQUE NOT NULL,
    label      TEXT NOT NULL,
    last_sync  TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
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
"""


def init() -> None:
    with get_db() as conn:
        conn.executescript(SCHEMA)


def list_accounts() -> list[dict]:
    with get_db() as conn:
        return [dict(r) for r in
                conn.execute("SELECT * FROM trader_accounts ORDER BY id")]


def get_account(acct_id: int) -> dict | None:
    with get_db() as conn:
        r = conn.execute("SELECT * FROM trader_accounts WHERE id=?", (acct_id,)).fetchone()
        return dict(r) if r else None


def add_account(wallet: str, label: str) -> dict:
    with get_db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO trader_accounts (wallet, label) VALUES (?, ?)",
            (wallet, label))
        r = conn.execute("SELECT * FROM trader_accounts WHERE wallet=?", (wallet,)).fetchone()
        return dict(r)


def delete_account(acct_id: int) -> None:
    with get_db() as conn:
        conn.execute("DELETE FROM trader_fills WHERE account_id=?", (acct_id,))
        conn.execute("DELETE FROM trader_tags WHERE account_id=?", (acct_id,))
        conn.execute("DELETE FROM trader_accounts WHERE id=?", (acct_id,))


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


def fills_for(acct_id: int) -> list[dict]:
    with get_db() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT * FROM trader_fills WHERE account_id=? ORDER BY ts, id",
            (acct_id,))]


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
