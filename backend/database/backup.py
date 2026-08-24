"""Nightly dump of the tables that cannot be recovered from any API.

Ticks and screener caches can be resurveyed; tracked-account fill history
(beyond Polymarket's 10k-row window), user accounts, and saved strategy
params cannot. The Aug 24 delete incident proved the point: one click cost
weeks of fill history and there was nothing to restore from. The whole DB is
~2 GB (too big to keep dailies of on this disk); these tables are a few MB
gzipped, so two weeks of them cost nothing.
"""
import gzip
import logging
import os
from datetime import datetime, timezone

from backend.config.settings import settings
from backend.database.db import get_db

log = logging.getLogger(__name__)

TABLES = (
    "trader_accounts", "trader_fills", "trader_tags", "trader_resolutions",
    "auth_users", "auth_sessions", "auth_invites",
    "backtest_strategies", "comeback_config", "football_config",
    "mlb_game_pks", "slug_prefixes",
)
KEEP = 14  # days


def _lit(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, bytes):
        return "X'" + v.hex() + "'"
    return "'" + str(v).replace("'", "''") + "'"


def run() -> str | None:
    """Write today's dump; drop dumps older than KEEP days. Returns the path."""
    base = os.path.dirname(os.path.abspath(settings.db_path))
    dest = os.path.join(base, "backups")
    os.makedirs(dest, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    path = os.path.join(dest, f"precious-{stamp}.sql.gz")
    rows = 0
    with get_db() as conn, gzip.open(path, "wt", encoding="utf-8") as out:
        out.write("-- restore into a FRESH db, or DROP the tables first\n")
        for t in TABLES:
            ddl = conn.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
                (t,)).fetchone()
            if not ddl:
                continue
            out.write(f"{ddl['sql']};\n")
            for r in conn.execute(f"SELECT * FROM {t}"):  # noqa: S608 — fixed list
                out.write(f"INSERT INTO {t} VALUES(" +
                          ",".join(_lit(v) for v in tuple(r)) + ");\n")
                rows += 1
    dumps = sorted(f for f in os.listdir(dest) if f.startswith("precious-"))
    for old in dumps[:-KEEP]:
        os.remove(os.path.join(dest, old))
    log.info("backup: %d rows across %d tables -> %s", rows, len(TABLES), path)
    return path
