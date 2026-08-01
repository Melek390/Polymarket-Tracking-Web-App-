# Connecting to the VM — quick runbook

Everything here is run from this machine (Git Bash). The private key is
`~/.ssh/polymarket_deploy` — it stays on your machine, never commit it.

## The box

| | |
|---|---|
| Host | `35.254.233.242` |
| SSH user | `claude-deploy` |
| Key | `~/.ssh/polymarket_deploy` |
| GCP VM | `stockinvestingalgos` — Debian 12, 2 vCPU / 2 GB, 10 GB disk |
| Public site | https://polymarket-tracker.duckdns.org |
| App directory | `/opt/polymarket-tracker` |
| systemd unit | `polymarket-tracker` (runs as the `tracker` user, `Restart=always`) |
| Python | `/opt/polymarket-tracker/venv/bin/python3` |
| Database | `/opt/polymarket-tracker/prices.db` (SQLite, WAL) |

> ⚠️ **This VM is shared.** `livetrader.service` is the client's **live cTrader
> trading bot** (`/home/slsks/trading/`). Never stop, edit or delete it, and
> never touch `/home/slsks/trading`.

## Connect

```bash
ssh -i ~/.ssh/polymarket_deploy claude-deploy@35.254.233.242
```

One-off command without an interactive session:

```bash
ssh -i ~/.ssh/polymarket_deploy claude-deploy@35.254.233.242 'uptime; df -h /'
```

If host-key prompts get in the way when scripting, add
`-o StrictHostKeyChecking=no`.

## Everyday operations

```bash
# is it up?
sudo systemctl status polymarket-tracker --no-pager | head -20

# live logs (Ctrl-C to stop)
sudo journalctl -u polymarket-tracker -f

# recent errors only
sudo journalctl -u polymarket-tracker --since "10 min ago" --no-pager \
  | grep -iE "error|traceback|exception"

# restart (only needed after a BACKEND change)
sudo systemctl restart polymarket-tracker

# health check — run before and after every deploy, exits non-zero on failure
cd /opt/polymarket-tracker && sudo -u tracker ./venv/bin/python3 scripts/healthcheck.py
```

The API is bound to `127.0.0.1:8000` (not exposed publicly); Caddy terminates
TLS and reverse-proxies to it. To hit it directly from on the box:

```bash
curl -s "http://127.0.0.1:8000/api/health"
curl -s "http://127.0.0.1:8000/api/screener/markets?sport=baseball" | head -c 400
```

## Deploying

Build locally first, then ship. **Frontend-only changes do not need a restart**
(the cache headers make browsers pick up a new bundle on the next load).

```bash
# 1. build
cd "frontend" && npm run build && cd ..

# 2a. frontend only
tar -czf /tmp/pmdist.tgz -C frontend dist
scp -i ~/.ssh/polymarket_deploy /tmp/pmdist.tgz claude-deploy@35.254.233.242:/tmp/
ssh -i ~/.ssh/polymarket_deploy claude-deploy@35.254.233.242 \
  'cd /opt/polymarket-tracker/frontend && sudo rm -rf dist \
   && sudo tar -xzf /tmp/pmdist.tgz && sudo chown -R tracker: dist'

# 2b. backend (or both) — restart required
tar -czf /tmp/pmdeploy.tgz --exclude='__pycache__' backend frontend/dist scripts
scp -i ~/.ssh/polymarket_deploy /tmp/pmdeploy.tgz claude-deploy@35.254.233.242:/tmp/
ssh -i ~/.ssh/polymarket_deploy claude-deploy@35.254.233.242 \
  'cd /opt/polymarket-tracker && sudo tar -xzf /tmp/pmdeploy.tgz \
   && sudo chown -R tracker: backend frontend/dist scripts \
   && sudo systemctl restart polymarket-tracker'

# 3. confirm the live bundle changed
curl -s https://polymarket-tracker.duckdns.org/ | grep -o 'index-[A-Za-z0-9_-]*\.js'
```

Never ship `venv`, `node_modules`, `prices.db*`, `.claude` or `.git`.

## Running a script against the app / database

Scripts must run **from the app directory** (so `backend` imports resolve) and
**as the `tracker` user** (so SQLite can write):

```bash
# copy it up, then run it
scp -i ~/.ssh/polymarket_deploy myscript.py claude-deploy@35.254.233.242:/tmp/
ssh -i ~/.ssh/polymarket_deploy claude-deploy@35.254.233.242 \
  'cd /opt/polymarket-tracker && sudo cp /tmp/myscript.py . \
   && sudo chown tracker: myscript.py \
   && sudo -u tracker ./venv/bin/python3 myscript.py; sudo rm -f myscript.py'
```

Gotchas learned the hard way:
- Quoting breaks easily over SSH — put Python in a **file** and copy it up
  rather than inlining it in the command.
- A read-only SQLite open still fails, because `get_db()` sets
  `PRAGMA journal_mode=WAL` (a write). For a genuinely read-only peek use
  `sqlite3.connect("file:/opt/polymarket-tracker/prices.db?immutable=1", uri=True)`.
- Don't load every tick for a market at once — that OOM'd the 2 GB box. Scope
  the query to a time window.
- `node` is **not** installed on the VM; run JS checks locally.

## Checking capacity

```bash
df -h /                                   # disk (was 100% full once)
sudo ls -lh /opt/polymarket-tracker/prices.db
sudo journalctl --disk-usage              # logs; no size cap set yet
free -m
```

## GitHub

`github.com/Melek390/Polymarket-Tracking-Web-App-` — push works from this
machine; the VM is deployed to by scp, not by pulling.
