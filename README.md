# Polymarket Price Tracker

A self-hosted web app that watches Polymarket prediction markets and saves
every price it sees into a local SQLite database. The collector runs on the
server, so data keeps flowing 24/7 whether the browser is open or not. The
web page is just a viewer and control panel on top of the data.

Everything is open source, with no paid services, no API keys and no Docker.
Polymarket's public read APIs need no authentication.

## Tech stack

Backend (Python 3.11+):

* FastAPI + Uvicorn serve the REST API and the built frontend on one port.
* APScheduler runs the polling jobs inside that same process.
* httpx makes the async calls to Polymarket's Gamma and CLOB APIs.
* pydantic / pydantic-settings validate requests and load settings from .env.
* SQLite (standard library) stores everything, in WAL mode.

Frontend (React 18):

* Vite builds it; the output in `frontend/dist` is served by the backend.
* Recharts draws the price charts.
* No CSS framework and no router library. Styling is inline, and routing is a
  small hash-based scheme, to keep the dependency list short.

All Python dependencies are pinned in `requirements.txt`; all frontend
dependencies are in `frontend/package.json`.

## What it does

### Track markets
Paste a Polymarket event URL, slug or numeric ID into the search bar and the
app lists every market inside that event: match winner, totals like
Over/Under 2.5, both teams to score, and so on. Tick the ones you care about
and each becomes its own price series with its own history and CSV export.

You can also paste several events at once, separated by semicolons, and tick
props across all of them at once:

    https://polymarket.com/event/first-event;second-event-slug;12345

### Search live markets (screener)
Instead of a URL you can type a search. Anything with a comma is treated as a
screener query in the form:

    sport, prop filter, price condition

For example:

    soccer, o/u 3.5, over < 40
    tennis, match o/u, over < 45
    baseball, strikeouts, under > 60
    cricket, toss
    soccer, spread, > 90
    soccer

Rules of thumb:

* The sport keyword is required. Supported: soccer (or football), tennis,
  baseball, mlb, basketball, nba, nfl, cricket, esports.
* The prop filter matches the market question text the way Polymarket writes
  it, so "o/u 2.5", "1st half", "spread", "both teams", "total kills",
  "toss", or simply a team name all work. It does not match outcome names,
  so searching "yes/no" finds nothing.
* The price part is "side < value" or "side > value" where the side is an
  outcome name (over, under, yes, a team). Leave the side out and any
  outcome can satisfy the condition. Prices are in cents; you can also write
  the old 0-to-1 form (0.40) and it is read as 40 cents.
* Results are capped at 50. Narrow the query if you hit the cap.

### Prices in cents
Prices are shown and stored in cents, from 0 to 100, matching how Polymarket
displays them (a 0.905 midpoint reads as 90.5 cents). This applies everywhere:
the charts, the tick table, the current-price badges and the CSV export.

### Historical backfill
The moment you track a market the app pulls everything Polymarket has for
it, at 1-minute resolution, going back to when the market opened. That can
be months of data and it lands in the same database as the live ticks, so
the chart, the table and the CSV all include it automatically. In the app
you can always see where history ends and live collection begins: the chart
draws a dashed line at that moment and the table shows a divider row, with
older rows tagged "hist".

Live collection and backfill can never overlap or duplicate each other. The
backfill only stores points from before the market was added, live polling
only stores points after, and the database enforces one price per outcome
per timestamp on top of that.

### Live polling
Tracked markets are polled every 5 seconds by default, configurable per
market from 1 second up (the API allows it, though 3 to 5 seconds is the
sensible range). Every poll stores one row per outcome. Nothing is averaged,
sampled or thrown away.

Polling is batched: all markets on the same interval share a single HTTP
request per cycle, so tracking fifty markets costs the same network traffic
as tracking one. This keeps usage far below Polymarket's rate limits.

### Closed market detection
When a market resolves, Polymarket removes its order book. The collector
notices (three empty polls in a row) and reacts on its own: polling stops,
the market shows a red CLOSED badge in the list, and the ticks table gets a
red line marking the moment. Markets that are merely lopsided, say 99 cents
against 1 cent, are not treated as closed. They are still open and their
price can still move, so they keep being polled until Polymarket actually
settles them.

### The dashboard list
Markets are grouped by event. An event with a single prop shows as one row;
an event with several props (a match winner plus its totals, spreads and so
on) shows as a box you expand and collapse with the blue plus/minus button,
its props drawn underneath on a small tree.

The list is organised so the useful things are on top: open markets first,
then paused, then closed, and within each of those the most recently added
appears first. So a market you just added lands at the top of its section.

Two sets of filters sit above the list, and both are also kept in the URL so
a filtered or paged view can be bookmarked and shared:

* Status: All, Open, Paused, Closed (each with a live count).
* View: All, Single props, Events only.

Long lists are paged. You choose how many per page (10 to 100, default 20)
and move with Previous and Next. The page number lives in the URL, so with
hundreds of pages you can jump straight to one by editing the address.

### Market history page
Opening a market (click its name or the History button) goes to its own URL,
like `#/market/12`, which you can share directly. The page shows:

* The current price of each outcome as a large colored badge, and a matching
  dot on the chart at the latest point, so the newest value is never hard to
  find.
* A line chart, one line per outcome. Hover for exact prices, and drag the
  blue slider under the chart to zoom into a time range. Open markets start
  focused on the last 10 minutes; closed markets open showing their whole
  life. Refreshing keeps your current zoom and position instead of resetting.
* A Live button. When on, the chart pulls new data on its own and follows the
  latest edge, so you can watch a market update without pressing Refresh.
* Horizontal guide lines at 10, 15, 20, 25, 30, 40 and 50 cents. Click one and
  every point where the price touched or crossed that level is marked, which
  makes studying past behaviour much easier.
* A Web link button that opens the market on polymarket.com.
* The recorded-ticks table, one row per poll, each price cell carrying a small
  up or down arrow against the previous tick, sortable newest or oldest first.

All timestamps everywhere are UTC, so what you see on screen matches the
database and the CSV exactly.

### CSV export
Every market has an export button in the list row and on its history page.
The file streams straight from the database: a timestamp column plus one
price column per outcome, ISO 8601 UTC, prices in cents, oldest row first,
full history including backfill. The filename is the market name plus the date
it was added, so repeat fixtures (the same two teams next week) stay distinct.

### Managing markets
Start and Stop pause or resume polling per market without touching stored
data. The red delete button removes a market and its entire history after a
confirmation dialog, and cannot be undone. The dashboard cards show how many
markets are active, the database size, the last successful update and how
many rows were stored today.

## Project layout

    backend/
      main.py          app entrypoint, run with uvicorn
      api/             REST route handlers
      collector/       polling scheduler and history backfill
      polymarket/      Gamma and CLOB API clients
      screener/        the market search
      database/        SQLite schema and queries
      models/          request validation
      config/          settings loaded from .env
    frontend/
      src/             React source
      dist/            built bundle, served by the backend
    deploy/
      polymarket-tracker.service   systemd unit
    prices.db          created on first run

## Configuration

Copy `.env.example` to `.env` and adjust if needed. The defaults are fine
for most setups: port 8000, database file `prices.db` next to the code,
5 second default poll interval. No secrets are involved.

## Running it locally

    python -m venv venv
    venv/bin/pip install -r requirements.txt      (Windows: venv\Scripts\pip)
    cp .env.example .env
    venv/bin/uvicorn backend.main:app --port 8000

Then open http://localhost:8000. The UI is served by the same process.

The built frontend is committed in `frontend/dist`, so you do not need Node
just to run the app. To work on the frontend, run `npm install` and
`npm run dev` inside `frontend/` for a hot-reloading dev server on port 5173,
and `npm run build` to rebuild the `dist/` bundle the backend serves.

## Deploying on Ubuntu

    sudo mkdir -p /opt/polymarket-tracker
    sudo cp -r . /opt/polymarket-tracker
    cd /opt/polymarket-tracker
    sudo python3 -m venv venv
    sudo venv/bin/pip install -r requirements.txt
    sudo cp .env.example .env
    sudo useradd --system --no-create-home tracker
    sudo chown -R tracker: /opt/polymarket-tracker
    sudo cp deploy/polymarket-tracker.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now polymarket-tracker

The service runs as its own low-privilege user named tracker (created by the
useradd line above). If you would rather run it as an existing user, edit
the User line in the service file before copying it.

The service restarts automatically if it crashes and starts on boot, which
is what keeps collection running through reboots and SSH logouts. Check on
it with:

    systemctl status polymarket-tracker
    journalctl -u polymarket-tracker -f

Run only one Uvicorn worker. The collector lives inside the web process, so a
second worker would poll and store everything twice.

There is no login on the app, so if it is exposed on a public IP, restrict the
firewall to the addresses that should reach it.

## Things worth knowing

* Disk usage: live polling is light (roughly 10 to 15 MB per day for ten
  two-outcome markets at 5 seconds), but backfill can add around 40 MB per
  outcome for a year-old market on day one. The dashboard shows the current
  database size.
* Prices are order book midpoints, stored in cents. The screener shows
  Polymarket's cached prices, which are close but not tick-accurate; the live
  midpoint takes over the moment you track a market.
* In backfilled history one outcome sometimes starts quoting a minute
  before another. Missing cells are shown as a dash and left empty in the
  CSV rather than invented.
* WAL mode is enabled on SQLite so the web UI reading data never blocks the
  collector writing it.
* The database keeps prices as cents (0 to 100). Older databases from before
  this change are converted once, automatically, on the first startup after
  upgrading.
* The per-market poll interval can be changed through the API
  (PATCH /api/markets/{id} with {"poll_interval": 3}); there is no UI
  control for it yet.

## Reliability: what happens when Polymarket breaks

Polymarket's API goes down, throttles, and changes shape from time to time.
The app is built to survive all three without losing data or needing a restart.
Here is exactly where each safeguard lives.

**Retries with backoff, on every price request**
`backend/polymarket/clob.py` lines 16 to 32. Each call is attempted up to
`MAX_RETRIES` times (5 by default). Between attempts it waits an exponentially
growing delay plus a random fraction of a second, so repeated failures back off
politely instead of hammering. An HTTP 429 (their "slow down" response) is
treated as a retry, not a crash. If every attempt fails, it raises a single
clear error naming the last thing that went wrong.

**A failed poll never stops the collector**
`backend/collector/scheduler.py` lines 33 to 37. The poll cycle catches that
error, writes `poll(5s) skipped: <reason>` to the log, and returns. The next
cycle runs normally seconds later. One bad market, or a full Polymarket outage,
can never stall collection for everything else.

**Backfill failures are isolated per outcome**
`backend/collector/backfill.py` lines 43 and 70 to 74. Each outcome's history
download is wrapped separately, so if one fails the others still complete and
the failure is logged with the market and outcome name.

**Network errors become readable messages, not stack traces**
`backend/api/routes.py` lines 47 to 52, 59 to 65, and 72 to 77. Anything that
fails while talking to Polymarket is turned into
`502 Polymarket unreachable: <the actual reason>`. Missing events give
`404 no event found for that URL or ID`, and bad input gives a `400` that says
what was wrong. The UI prints these messages in a red banner, so the person
using the app sees the real cause instead of a blank failure.

**Defensive parsing, in case they change their format**
`backend/polymarket/gamma.py` lines 29 to 36. Polymarket returns some fields as
JSON encoded inside JSON. That decoding is wrapped so malformed or changed data
is skipped rather than crashing the request. Markets whose outcomes and token
ids do not line up are skipped instead of being half stored.

**Data can never be corrupted by a retry**
A unique index on (outcome, timestamp) plus `INSERT OR IGNORE` in
`backend/database/db.py` means storing the same tick twice is impossible, so
retries, restarts and overlapping backfills are all safe.

**Seeing what happened**
Everything above is written to the service log. To read it live:

    journalctl -u polymarket-tracker -f

Set `LOG_LEVEL=DEBUG` in `.env` for per-poll detail.

## Polymarket rate limits

The collector sends **one batched request per poll cycle no matter how many
markets are tracked**, which keeps usage far under Polymarket's published
limits. Tracking 500 markets costs the same number of requests as tracking one.

| Endpoint used | Polymarket's limit | This app's usage |
|---|---|---|
| CLOB `/midpoints` (live polling) | 500 req / 10s | about 2 to 3 req / 10s |
| CLOB `/prices-history` (backfill) | 1,000 req / 10s | a short sequential burst when a market is first added |
| Gamma `/events` (lookup, screener) | 500 req / 10s | only when someone searches |

That is under 1% of the allowance for the continuous polling, and the backoff
described above handles the rest if they ever throttle anyway.

## API

The frontend uses a small JSON API you can also call directly. Interactive
documentation is served at /docs.

    GET    /api/dashboard                    stats for the dashboard cards
    GET    /api/markets                      all markets with status and counts
    POST   /api/events/lookup                find an event by URL, slug or id
    POST   /api/events/track                 start tracking selected markets
    POST   /api/screener                     search live markets
    POST   /api/markets/{id}/start           resume polling
    POST   /api/markets/{id}/stop            pause polling, data kept
    PATCH  /api/markets/{id}                 change the poll interval
    DELETE /api/markets/{id}                 remove market and all its data
    GET    /api/markets/{id}/ticks           paged time series rows
    GET    /api/markets/{id}/export.csv      full history as CSV
