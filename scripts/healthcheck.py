#!/usr/bin/env python3
"""Pre-deploy smoke test + data-integrity check.

Run it on the VM before and after a deploy:

    cd /opt/polymarket-tracker && sudo -u tracker ./venv/bin/python3 scripts/healthcheck.py

Every check prints PASS / WARN / FAIL and the script exits non-zero if anything
FAILed, so it can gate a deploy. The checks target the bug patterns that have
actually bitten this app:
  * silent failure  — an endpoint returns 200 with empty or half-filled data
  * stale data      — jobs stopped, caches empty, tracked markets receiving
                      nothing (this is how the collector broke twice)
  * API assumptions — our prices must still equal Polymarket's midpoint
  * capacity        — disk/DB headroom, which took the app down at 100% full
"""
import argparse
import json
import shutil
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = "http://127.0.0.1:8000"
SPORTS = ["soccer", "basketball", "baseball", "tennis", "football", "cricket", "esports"]
SLOW_SECONDS = 3.0          # an endpoint slower than this is a warning
STALE_TICK_MINUTES = 15     # a tracked market silent longer than this is suspect
MIN_DISK_FREE_GB = 1.0

results = []  # (level, name, detail)


def record(level, name, detail=""):
    results.append((level, name, detail))
    print(f"  [{level:4}] {name}" + (f" — {detail}" if detail else ""))


def get(path, timeout=20):
    started = time.time()
    with urllib.request.urlopen(BASE + path, timeout=timeout) as r:
        return json.load(r), time.time() - started


# ---------------------------------------------------------------- smoke tests

def check_api():
    print("\nAPI endpoints")
    for sport in SPORTS:
        try:
            data, secs = get(f"/api/screener/markets?sport={sport}")
            rows = data.get("rows", [])
            if not isinstance(rows, list):
                record("FAIL", f"screener/{sport}", "malformed response")
            elif secs > SLOW_SECONDS:
                record("WARN", f"screener/{sport}", f"{len(rows)} rows but slow ({secs:.1f}s)")
            elif not rows and sport not in ("basketball",):  # basketball is off-season
                record("WARN", f"screener/{sport}", "no rows (off-season?)")
            else:
                record("PASS", f"screener/{sport}", f"{len(rows)} rows in {secs:.2f}s")
        except Exception as e:
            record("FAIL", f"screener/{sport}", str(e))

    for path in ("/api/dashboard", "/api/markets"):
        try:
            _, secs = get(path)
            level = "WARN" if secs > SLOW_SECONDS else "PASS"
            record(level, path, f"{secs:.2f}s")
        except Exception as e:
            record("FAIL", path, str(e))


def check_mlb():
    """Baseball rows must resolve to a real game, and the MLB extras must work."""
    print("\nMLB pipeline")
    try:
        data, _ = get("/api/screener/markets?sport=baseball")
    except Exception as e:
        record("FAIL", "baseball rows", str(e))
        return
    rows = data.get("rows", [])
    withpk = [r for r in rows if r.get("game_pk")]
    if not rows:
        record("WARN", "baseball rows", "no games listed")
        return
    ratio = len(withpk) / len(rows)
    record("PASS" if ratio > 0.8 else "FAIL", "gamePk matching",
           f"{len(withpk)}/{len(rows)} rows matched to an MLB game")
    if not withpk:
        return

    pk = withpk[0]["game_pk"]
    try:
        state, secs = get(f"/api/mlb/game/{pk}")
        if state is None:
            record("WARN", "mlb/game", "null state (game may not be on the slate)")
        elif "away" not in state or "innings" not in state:
            record("FAIL", "mlb/game", "state missing expected fields")
        else:
            record("PASS", "mlb/game", f"{state.get('status')} in {secs:.2f}s")
    except Exception as e:
        record("FAIL", "mlb/game", str(e))

    try:
        text, secs = get(f"/api/mlb/analyze/{pk}")
        body = text.get("text", "")
        missing = [k for k in ("Teams:", "Current Score:", "Pitcher on mound:",
                               "Next batters due up:", "Season series:") if k not in body]
        record("FAIL" if missing else "PASS", "mlb/analyze",
               f"missing {missing}" if missing else f"complete in {secs:.2f}s")
    except Exception as e:
        record("FAIL", "mlb/analyze", str(e))

    slug = withpk[0].get("event_slug") or withpk[0].get("slug")
    if slug:
        try:
            tl, secs = get(f"/api/mlb/timeline?slug={slug}")
            plays = tl.get("plays", [])
            if not plays:
                record("WARN", "mlb/timeline", "no plays (pre-game is normal)")
            else:
                p = plays[0]
                ok = all(k in p for k in ("start", "inning", "pitcher", "awayScore"))
                record("PASS" if ok else "FAIL", "mlb/timeline",
                       f"{len(plays)} plays in {secs:.2f}s")
        except Exception as e:
            record("FAIL", "mlb/timeline", str(e))


def check_prices():
    """Our displayed price must still equal Polymarket's midpoint."""
    print("\nPrice correctness")
    sys.path.insert(0, ".")
    try:
        import asyncio
        from backend.database import db
        from backend.polymarket import clob
    except Exception as e:
        record("WARN", "price check", f"cannot import backend ({e})")
        return

    rows = [r for r in db.screener_rows("baseball") if r.get("token_ids")][:3]
    if not rows:
        record("WARN", "price check", "no baseball rows with tokens")
        return

    async def run():
        for r in rows:
            slug = r["event_slug"]
            try:
                ours, _ = get(f"/api/screener/live-price?slug={slug}")
            except Exception as e:
                record("FAIL", f"live-price {slug[:22]}", str(e))
                continue
            toks = json.loads(r["token_ids"])
            mids = await clob.fetch_mid_prices([t for t in toks if t])
            keys = ["home", "away"] if len(toks) == 2 else ["home", "draw", "away"]
            worst = 0
            for k, t in zip(keys, toks):
                a, b = ours.get(k), mids.get(t)
                if a is not None and b is not None:
                    worst = max(worst, abs(a - b))
            # a couple of cents of drift is just the market moving between calls
            record("PASS" if worst <= 3 else "FAIL", f"live-price {slug[:22]}",
                   f"max diff vs CLOB midpoint {worst:.1f}c")
    asyncio.run(run())


# ----------------------------------------------------------- data integrity

def check_data():
    print("\nData integrity")
    sys.path.insert(0, ".")
    try:
        from backend.database import db
    except Exception as e:
        record("FAIL", "database", str(e))
        return

    now = datetime.now(timezone.utc)
    with db.get_db() as c:
        # tracked markets that never stored anything — the backfill bug
        empty = c.execute("""
            SELECT m.id FROM markets m WHERE m.tracking = 1 AND NOT EXISTS
            (SELECT 1 FROM ticks t JOIN outcomes o ON t.outcome_id = o.id
             WHERE o.market_id = m.id)""").fetchall()
        record("PASS" if not empty else "FAIL", "markets with no history",
               f"{len(empty)} tracked market(s) have zero ticks: {[r['id'] for r in empty][:6]}"
               if empty else "none")

        # tracked+open markets that have gone quiet — the collector stopping
        cutoff = (now - timedelta(minutes=STALE_TICK_MINUTES)).strftime("%Y-%m-%dT%H:%M:%SZ")
        stale = c.execute("""
            SELECT m.id, MAX(t.ts) last FROM markets m
            JOIN outcomes o ON o.market_id = m.id
            LEFT JOIN ticks t ON t.outcome_id = o.id
            WHERE m.tracking = 1 AND m.closed = 0
            GROUP BY m.id HAVING last IS NULL OR last < ?""", (cutoff,)).fetchall()
        record("PASS" if not stale else "WARN", "collector freshness",
               f"{len(stale)} open market(s) with no tick in {STALE_TICK_MINUTES}m: "
               f"{[r['id'] for r in stale][:6]}" if stale else "all open markets are current")

        # screener cache populated per sport
        for sport in SPORTS:
            n = c.execute("SELECT COUNT(*) n FROM screener_cache WHERE sport = ?",
                          (sport,)).fetchone()["n"]
            if n == 0 and sport != "basketball":
                record("WARN", f"cache/{sport}", "empty")

        # outcomes must have tokens or they can never be priced
        notok = c.execute(
            "SELECT COUNT(*) n FROM outcomes WHERE token_id IS NULL OR token_id = ''"
        ).fetchone()["n"]
        record("PASS" if notok == 0 else "FAIL", "outcomes have tokens",
               f"{notok} outcome(s) missing a token" if notok else "all outcomes priceable")

    # chart data must not be half-filled (the shattered-line bug)
    try:
        markets, _ = get("/api/markets")
        live = [m for m in markets if m.get("tracking") and not m.get("closed")]
        if live:
            mid = live[0]["id"]
            ticks, _ = get(f"/api/markets/{mid}/ticks?limit=400")
            n_out = len(live[0].get("outcomes", []))
            partial = [t for t in ticks if len(t.get("prices", {})) < n_out]
            share = len(partial) / len(ticks) if ticks else 0
            record("PASS" if share < 0.25 else "FAIL", "chart rows complete",
                   f"{len(partial)}/{len(ticks)} rows missing a price on market {mid}")
    except Exception as e:
        record("WARN", "chart rows complete", str(e))


def check_jobs():
    """Asked over the API so we see the jobs in the RUNNING process — a market
    closing once deleted every background job and nothing noticed."""
    print("\nBackground jobs")
    try:
        data, _ = get("/api/health")
    except Exception as e:
        record("FAIL", "scheduler", str(e))
        return
    if not data.get("running"):
        record("FAIL", "scheduler", "not running")
        return
    ids = set(data.get("jobs", []))
    for job in ("screener-cache", "mlb-live", "live-prices", "mlb-intervals"):
        record("PASS" if job in ids else "FAIL", f"job {job}",
               "scheduled" if job in ids else "MISSING")
    # A poll-* job only exists while something is actually being collected, so
    # "none scheduled" is only wrong if there IS an open tracked market. With
    # the slate finished (every market resolved and untracked) or everything
    # paused, having none is correct — failing regardless cried wolf every
    # night and this is the gate we run before every deploy.
    pollers = [j for j in ids if j.startswith("poll-")]
    if pollers:
        record("PASS", "collector poll jobs", ", ".join(sorted(pollers)))
        return
    try:
        markets, _ = get("/api/markets")
        wanted = [m for m in markets if m.get("tracking") and not m.get("closed")]
    except Exception as e:
        record("FAIL", "collector poll jobs", f"no poll-* job, and /api/markets failed: {e}")
        return
    if wanted:
        record("FAIL", "collector poll jobs",
               f"{len(wanted)} open tracked market(s) but no poll-* job scheduled")
    else:
        record("PASS", "collector poll jobs",
               "none needed — no open tracked market right now")


def check_capacity():
    print("\nCapacity")
    total, used, free = shutil.disk_usage("/")
    gb = free / 1024**3
    record("PASS" if gb >= MIN_DISK_FREE_GB else "FAIL", "disk free",
           f"{gb:.1f} GB free of {total/1024**3:.0f} GB")
    try:
        stats, _ = get("/api/dashboard")
        size_gb = (stats.get("db_size_bytes") or 0) / 1024**3
        record("PASS", "database size", f"{size_gb:.2f} GB, {stats.get('total')} markets")
    except Exception as e:
        record("WARN", "database size", str(e))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=BASE, help="API base url")
    args = ap.parse_args()
    globals()["BASE"] = args.base

    print(f"Polymarket tracker health check — {datetime.now(timezone.utc):%Y-%m-%d %H:%M:%S} UTC")
    for fn in (check_api, check_mlb, check_prices, check_data, check_jobs, check_capacity):
        try:
            fn()
        except Exception as e:
            record("FAIL", fn.__name__, f"check crashed: {e}")

    fails = [r for r in results if r[0] == "FAIL"]
    warns = [r for r in results if r[0] == "WARN"]
    print(f"\n{'='*60}\n{len(results)} checks — "
          f"{len(results)-len(fails)-len(warns)} passed, {len(warns)} warnings, {len(fails)} failed")
    for lvl, name, detail in fails:
        print(f"  FAIL  {name} — {detail}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
