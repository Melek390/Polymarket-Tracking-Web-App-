# Session 2 — Backend build, wiring, live features

Date: July 16, 2026 (ongoing)

## Done so far this session

- **Backend complete & live-tested**: `database/db.py` (schema + WAL + queries,
  unique index on (outcome_id, ts), INSERT OR IGNORE), `polymarket/gamma.py` +
  `clob.py` (live-tested), `collector/scheduler.py` (one job per interval),
  `collector/backfill.py`, `api/routes.py` (+ DELETE), `main.py` (lifespan +
  serves dist/). One-line human docstrings everywhere.
- **Frontend wired to real API**: mocks replaced by fetch() in `client.js`
  (all field mapping in one place). Full-width layout (1100px cap removed).
- **History backfill**: on track, pulls ALL 1-min history via /prices-history
  (3-day windows, startTs/endTs — named intervals cap fidelity). Stops when a
  window adds no new points (API re-serves earliest data — found live).
  Backfill only stores ticks < created_at; live only > created_at.
- **Closed-market detection**: 3 consecutive polls with all tokens missing
  from /midpoints → market closed (closed/closed_at cols + migration),
  tracking off, job removed, start blocked w/ 400.
- **UI additions**: OPEN/PAUSED/CLOSED dot+label per row, red closed divider
  + "tracking started" divider in ticks table, dashed ReferenceLine on chart,
  "added <date>" metadata, delete button (red ✕) with themed ConfirmDialog
  (native confirm() rejected by user), all timestamps UTC-consistent.
- **Bugs fixed live**: missing outcome price crashed history view
  (row[o].toFixed on undefined → now "—"); UTC date + local time mixing;
  backfill infinite paging; timezone display.

## Facts worth remembering

- Match resolved on Polymarket → CLOB /midpoints returns {} for its tokens
  (that's the close signal; last real tick stays in db).
- /prices-history: fidelity=1 works ONLY with explicit startTs/endTs windows
  (~3 days max); interval=max silently coarsens to 10-min.
- Run server: `venv\Scripts\uvicorn backend.main:app --port 8000` from project
  root (serves UI at :8000). LOG_LEVEL=DEBUG in .env shows per-poll lines.
- prices.db currently holds: 2 closed BLG/T1 markets + 3 open Spain/Argentina
  markets the user tracked themselves.

## Screener (added this session)

- Search bar is dual-purpose: comma = screener query, else event URL/slug.
- `backend/screener/screener.py`: sport tag map + comma parsing + local
  filtering of Gamma `outcomePrices`; `POST /api/screener`, 50-result cap.
- Full query grammar + verified examples in `screener-formats.md` (README
  material). Key gotcha: prop filter matches QUESTION text, not outcome
  labels — `yes/no` matches nothing.
- Gamma sport tag ids: soccer 100350, tennis 864, baseball 678, mlb 100381,
  basketball 28, nba 745, nfl 450, cricket 517, esports 64.

## Remaining for delivery

1. `deploy/polymarket-tracker.service` (systemd unit — still empty placeholder;
   module path is backend.main:app, NOT the spec's app.main:app).
2. README: copy-paste Ubuntu install (venv, pip, systemd enable) + note that
   backfill can grow the db ~40 MB per outcome-year.
3. PATCH poll_interval has no UI control yet (backend works).
4. 10-minute acceptance test from spec §7 checklist.
