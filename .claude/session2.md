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

## July 17 — polish + first deployment

### Features added
- Multi-event lookup: `URL1;URL2;URL3` in the search bar (any mix of URLs,
  slugs, ids). Frontend-only: Promise.allSettled over /api/events/lookup,
  pooled into ScreenerPanel (gained title/emptyText props + optional prices).
  Search routing: `;` = multi-lookup, `,` = screener, else single lookup.
- Select-all checkbox in BOTH selection panels (EventPanel + ScreenerPanel —
  they are separate components, user caught that only one had it).
- CSV downloads named after the market: backend slugifies
  "{event_title} {question}" into Content-Disposition; frontend defers to it.
- Favicon: original sparkline SVG in frontend/public/ (deliberately NOT the
  Polymarket logo — trademark; user can drop their favicon.ico in if client
  insists).
- Text cleanup pass: removed ── decorations from table dividers, bumped both
  dividers to 12px semibold (closed = red, tracking-started = ink).

### Decisions discussed
- No event-driven/on-change tick storage: fixed-interval polling is a client
  promise (spec: nothing discarded); WebSocket streaming is the V2 upsell.
- Markets pinned at 0.999/0.001 are NOT closed — book still answers polls,
  price can still move. Closed = book gone. Optional "≈decided" display tag
  offered, not built.
- README.md fully rewritten (human tone, no dash-art) + systemd unit filled
  (backend.main:app, NOT spec's app.main:app). Both done.

### Deployment (client test, live now)
- Host: user's existing GCP VM `stockinvestingalgos` (Debian 12, 2 vCPU,
  2 GB RAM, us-central1-f) — shared with their Telegram bot, bot untouched.
  Did NOT delete the stopped stocks-bot VM (advised against).
- Access: SSH as claude-deploy@35.254.233.242, key ~/.ssh/polymarket_deploy
  (added via GCP metadata). Firewall rule allow-tracker-8000 (0.0.0.0/0 —
  fine for 2-day test, tighten or add auth if it stays up).
- Deployed via tar+scp (500 KB, dist/ committed so no Node on VM) to
  /opt/polymarket-tracker; venv on system Python 3.11.2; systemd unit
  enabled, runs as `tracker` user.
- Disk was 96% full: vacuumed journals + apt cache (~550 MB), then purged
  Wine at user's request (winehq-stable + i386 deps, /opt/wine-stable) —
  freed 2 GB total, now 2.7 GB free (71%).
- Verified end to end from outside: tracked "Will Spain win on 2026-07-19?"
  (slug fifwc-esp-arg-2026-07-19), backfill 2,457 rows, live 5s polls.
- **Client test URL: http://35.254.233.242:8000**
- VM sizing advice given: e2-small / 2 GB / 20-30 GB SSD is the permanent
  recommendation; exactly ONE uvicorn worker ever (collector runs in-process).

## Remaining

1. Push code to github.com/Melek390/Polymarket-Tracking-Web-App- (repo
   created, empty; needs gh auth or credentials — then VM can git pull).
2. PATCH poll_interval has no UI control yet (backend works).
3. 10-minute acceptance test from spec §7 checklist (partly covered by the
   VM smoke test; do the full chart/toggle/delta/CSV pass with the client).
4. If the test instance outlives 2 days: restrict firewall to client IP or
   add basic auth (app has no login).
5. Optional ideas parked: "≈decided" tag for pinned prices, closed divider
   at last real tick instead of detection time, styled Stop confirmation.
