# Polymarket Price Tracker

A self-hosted web app that watches Polymarket prediction markets and saves
every price it sees into a local SQLite database. The collector runs on the
server, so data keeps flowing 24/7 whether the browser is open or not. The
web page is just a viewer and control panel on top of the data.

Built with Python (FastAPI, APScheduler, httpx) and React (Vite, Recharts).
Everything is open source, there are no paid services, no API keys and no
Docker. Polymarket's public read APIs need no authentication.

## What it does

### Track markets
Paste a Polymarket event URL, slug or numeric ID into the search bar and the
app lists every market inside that event: match winner, totals like
Over/Under 2.5, both teams to score, and so on. Tick the ones you care about
and each becomes its own price series with its own history and CSV export.

You can also paste several events at once, separated by semicolons:

    https://polymarket.com/event/first-event;second-event-slug;12345

All their markets appear in one list and you can tick across events freely.

### Search live markets (screener)
Instead of a URL you can type a search. The format is:

    sport, prop filter, price condition

For example:

    soccer, o/u 3.5, over < 0.40
    tennis, match o/u, over < 0.45
    baseball, strikeouts, under > 0.60
    cricket, toss
    soccer, spread, > 0.90
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
  outcome can satisfy the condition. Prices are probabilities from 0 to 1.
* Results are capped at 50. Narrow the query if you hit the cap.

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
red line marking the moment. Markets that are merely lopsided, say 0.999
against 0.001, are not treated as closed. They are still open and their
price can still move, so they keep being polled until Polymarket actually
settles them.

### Charts and the tick table
Each market has a history page with a line chart (one line per outcome,
hover for exact prices at three decimals, drag the strip under the chart to
zoom) and a chronological table with one row per poll. Every price cell
carries a small up or down arrow against the previous tick. The table can be
sorted newest first or oldest first. All timestamps everywhere are UTC, so
what you see on screen matches the database and the CSV exactly.

### CSV export
Every market has an export button in the list row and on its history page.
The file streams straight from the database: a timestamp column plus one
price column per outcome, ISO 8601 UTC, three decimals, oldest row first,
full history including backfill.

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

To work on the frontend, run `npm install` and `npm run dev` inside
`frontend/` for a hot-reloading dev server on port 5173, and `npm run build`
to produce the `dist/` bundle the backend serves.

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

## Things worth knowing

* Disk usage: live polling is light (roughly 10 to 15 MB per day for ten
  two-outcome markets at 5 seconds), but backfill can add around 40 MB per
  outcome for a year-old market on day one. The dashboard shows the current
  database size.
* Prices are order book midpoints. The screener shows Polymarket's cached
  prices, which are close but not tick-accurate; the live midpoint takes
  over the moment you track a market.
* In backfilled history one outcome sometimes starts quoting a minute
  before another. Missing cells are shown as a dash and left empty in the
  CSV rather than invented.
* WAL mode is enabled on SQLite so the web UI reading data never blocks the
  collector writing it.
* The per-market poll interval can be changed through the API
  (PATCH /api/markets/{id} with {"poll_interval": 3}); there is no UI
  control for it yet.

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
