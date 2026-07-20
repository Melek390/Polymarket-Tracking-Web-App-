# Session 3 — client feedback round + cents migration (July 18-19, 2026)

Read session1.md + session2.md first for project basics. Spec: polymarket-tracker-v1-spec.pdf.

## Current state (end of session 3)

- Tracker service on VM is STOPPED (user asked). Restart:
  `ssh -i ~/.ssh/polymarket_deploy claude-deploy@35.254.233.242 "sudo systemctl start polymarket-tracker"`
  Still enabled → auto-returns on VM reboot. URL: http://35.254.233.242:8000
- Client had 33 markets, ~120 MB db. Backup of pre-cents db on VM:
  /opt/polymarket-tracker/prices-backup-pre-cents.db — DELETE once client
  confirms prices look right.
- Deploy recipe: build → tar (frontend/dist only if frontend-only) → scp →
  extract to /opt/polymarket-tracker → chown tracker: → restart if backend.

## Implemented this session (client's 19-item list; #19 dropped, #9 was done)

- PRICES ARE NOW CENTS EVERYWHERE INCLUDING THE DB (client insisted).
  Stored 0..100; converted at insert (poll/backfill: round(p*100,2));
  migration in init_db guarded by PRAGMA user_version=1 (never re-runs);
  CSV = cents %.2f; screener accepts "over < 0.40" AND "over < 40";
  fmtCents(cents) just formats. APIs from Polymarket stay 0..1 fractions.
- History page: current-price chips + colored end-dots on chart; Live toggle
  (refetch at pollInterval, follows edge only in live mode); manual Refresh
  NEVER moves the view (win=[fromTs,toTs] state in MarketHistory, ts-based,
  Brush keyed on data identity); default view = last 10 min; Back = real
  button; Web ↗ → polymarket.com/event/{eventSlug}.
- Chart: blue Brush (#2563EB, 12px handles); price level dashed lines
  10/15/20/25/30/40/50¢ in #8B929E (selected = ink 1.8px), click level →
  ReferenceDots at touches (max 300) + counter; Y-axis ticks at every level
  value; latest dots r=5 white ring.
- Dashboard: hash routing #/market/{id} and #/?page=&per=&status= (App.jsx
  parseHash); status filters w/ counts; pagination on event groups
  (10-100/page, default 20); groups keyed by event_slug (FIX for "deleted
  my old Dodgers game" — was title-merging, no data ever lost); single-prop
  events render flat; multi-prop groups: prop-row-aligned header (grid GRID,
  records in records column, [+]/[−] button far right where ✕ lives),
  default expanded; "added <date>" everywhere; market name clickable;
  CSV filename = slug + added date.
- theme: sub #3F4854, faint #646B76 (readability).

## Key invariants (don't break)

- db prices = cents 0..100, user_version=1. Never multiply again.
- Group by event_slug, never title. One uvicorn worker only.
- Brush window is timestamps, not indexes.
- fmtCents takes cents. Polymarket APIs return fractions — convert at door.

## Open items

1. Delete VM db backup after client confirms cents.
2. Push repo to github.com/Melek390/Polymarket-Tracking-Web-App- (needs gh auth).
3. Firewall open 0.0.0.0/0 + no auth — tighten if instance stays up.
4. Poll-interval UI control (backend PATCH works).
5. Formal spec §7 acceptance pass with client.
