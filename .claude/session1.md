# Session 1 — Project setup + frontend + settings.py

Date: July 15–16, 2026
Spec: `polymarket-tracker-v1-spec.pdf` (read in full — the source of truth)

## Project

Polymarket Price Tracker V1 for a client. Self-hosted app that polls Polymarket
market prices 24/7 server-side and stores every tick in SQLite. FastAPI +
APScheduler + httpx backend, React 18 + Vite + Recharts frontend, systemd on
Ubuntu for deployment. Read-only public APIs, no keys. Timeline quoted: 3–4 days.

## What was built

### Structure & dependencies
- Folder layout: `backend/` split by functionality (one folder per module —
  user's explicit preference over the spec's flat `app/` layout):
  `api/`, `collector/`, `polymarket/` (gamma.py + clob.py), `database/`,
  `models/`, `config/`. Plus `frontend/`, `deploy/` (systemd unit placeholder).
- `venv/` on Python 3.11.3 (3.14 available but skipped for compatibility).
  Installed: fastapi, uvicorn[standard], apscheduler, httpx, pydantic-settings,
  python-dotenv (`requirements.txt`).
- `.env` / `.env.example` (no secrets — public APIs), `.gitignore`, `README.md`.
- `frontend/package.json`: react 18, react-dom, recharts 2.15, vite 5. Installed.

### Frontend — COMPLETE on mock data (both views)
- View 1 Dashboard (`src/views/Dashboard.jsx`): stats row, add-event bar,
  event panel with prop checkboxes, market list (CSS grid, sparklines,
  outcome chips, Start/Stop/CSV/History buttons).
- View 2 Market History (`src/views/MarketHistory.jsx`): Recharts LineChart
  (Y 0–1, tooltip 3 decimals, Brush zoom), action row (Export CSV primary
  dark), ticks table (sticky tinted headers, Newest/Oldest toggle, ▲/▼ deltas).
- `App.jsx` = tiny state-based router (`{view:"dashboard"} | {view:"market",id}`),
  no router library (dependency-light per client).
- `src/api/client.js` = mock layer; each function has a one-line comment naming
  the real endpoint that replaces it (spec §5.2). Swapping mocks for fetch()
  touches only this file.
- `src/theme.js` = design tokens from spec §6.1 + shared styles (`card`, `label`,
  `page`, `btn.*`, `monoText`). `global.css` only holds keyframes/hover/focus.
- Code was cleaned on request: all tutorial comments deleted, duplicated styles
  hoisted to theme.js. Layout byte-identical. Build passes (`npm run build`).
- Dev server: `cd frontend && npm run dev` → http://localhost:5173
  (`/api` proxied to :8000 in vite.config.js).

### Backend — started
- `backend/config/settings.py` DONE: pydantic-settings class + shared `settings`
  instance. Vars: host, port, db_path, default_poll_interval, http_timeout,
  max_retries, gamma_base_url, clob_base_url, log_level. Verified loading.
- Everything else is empty placeholder files.

## Decisions & user preferences
- User is a Python dev, new to React — got a full React walkthrough after the
  dashboard build, then said "no need to explain, just do it" mid-task:
  keep explanations short unless asked.
- "Keep the code the simplest, not overcomplicated, no overcomplicated
  planning" — explicit instruction for the backend work.
- One backend module per folder (modularity requirement).
- Kept endpoint-mapping comments in client.js (spec requires mocks to be
  commented with their replacement API call).
- Recharts 2.x kept (mockup fidelity); npm flags it EOL — v3 bump is an open
  question for the client's long-term plans.
- Fonts load from Google Fonts; consider self-hosting before delivery.
- Approved mockup `polymarket-tracker-dashboard.jsx` referenced by the spec is
  NOT in the workspace — frontend was built from spec §6 alone.

## Next steps (agreed order)
1. `database/db.py` — spec §3 schema (events → markets → outcomes → ticks),
   WAL mode, queries. ← NEXT
2. `polymarket/gamma.py` + `clob.py` — httpx clients, test against live APIs.
3. `collector/scheduler.py` — batch polling, backoff w/ jitter on 429.
4. `api/routes.py` — REST contract spec §5.2, then `main.py` glue.
5. Wire frontend mocks to real API, build dist/, systemd unit + README.
