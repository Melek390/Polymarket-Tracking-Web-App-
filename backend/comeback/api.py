"""/api/comeback — the Comeback Setup triggers and their configuration.

  GET  /active      today's triggers (acked ones included, flagged) for the UI
  POST /ack         {"id": n} — the client "checked" it; the flash stops
  GET  /config      current thresholds
  PUT  /config      partial update, unknown keys refused
  GET  /log?limit=  full history for review / backtesting
"""

from fastapi import APIRouter, HTTPException

from datetime import datetime, timedelta, timezone

from backend.comeback import store

router = APIRouter(prefix="/api/comeback", tags=["comeback"])


@router.get("/active")
def active():
    """Last 24h of triggers, each flagged stale when its game already has a
    recorded outcome or it is hours old. Stale ones are history for the day
    tag — the UI must never toast, sound, or flash them (the client logged
    in to a wall of last night's alerts, Aug 26)."""
    triggers = store.recent(hours=24)
    cutoff = (datetime.now(timezone.utc)
              - timedelta(hours=6)).strftime("%Y-%m-%dT%H:%M:%SZ")
    for t in triggers:
        t["stale"] = bool(t.get("outcome")) or (t.get("created_at") or "") < cutoff
    return {"triggers": triggers}


@router.post("/ack")
def ack(body: dict):
    """Check means "I have seen this GAME": several pitchers can trigger in
    one game, and acking a single id left a sibling flashing — Check looked
    broken. game_pk acks them all; a bare id still works."""
    game_pk = int(body.get("game_pk") or 0)
    if game_pk:
        return {"ok": True, "acked": store.ack_game(game_pk)}
    trigger_id = int(body.get("id") or 0)
    if not store.ack(trigger_id):
        raise HTTPException(404, "no such unacknowledged trigger")
    return {"ok": True}


@router.get("/config")
def get_config():
    return store.config()


@router.put("/config")
def put_config(body: dict):
    try:
        return store.save_config(body or {})
    except (ValueError, TypeError) as e:
        raise HTTPException(400, str(e))


@router.get("/log")
def log(limit: int = 200):
    return {"triggers": store.log(limit)}
