# Session 4 — (July 19, 2026)

Read session1-3.md for history. Key invariants in session3.md (db = cents,
group by event_slug, brush window = timestamps, one uvicorn worker).

## State at start

- App LIVE on VM: http://35.254.233.242:8000 (restarted after y'day's stop).
  Client at 33 markets / ~120 MB. SSH + deploy recipe in session3.md.
- Local working tree = deployed version. Git: single commit 3b1a5bc
  (July 17, pre-cents) — local+GitHub identical. Rollback attempt aborted
  by user ("too risky"); recommended committing current state (not done yet).
- Pre-cents db backup still on VM (delete after client confirms cents ok).

## Diagnosed, not yet fixed

- Client: closed markets always open on an "empty" chart. Cause: #10's
  default last-10-min window shows the pinned 0/100 tail of finished games.
  Fix agreed in principle: open markets → last 10 min; closed markets →
  full history default. (~5 lines in MarketHistory load()).

## Session 4 log

- Closed-market default window FIXED + deployed (July 20): first load shows
  full history for closed markets, last 10 min for open ones
  (MarketHistory.load, one condition). Bundle index-BTCfPLsm.js.
