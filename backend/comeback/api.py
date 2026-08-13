"""/api/comeback — the Comeback Setup triggers and their configuration.

  GET  /active      today's triggers (acked ones included, flagged) for the UI
  POST /ack         {"id": n} — the client "checked" it; the flash stops
  GET  /config      current thresholds
  PUT  /config      partial update, unknown keys refused
  GET  /log?limit=  full history for review / backtesting
"""

from fastapi import APIRouter, HTTPException

from backend.comeback import store

router = APIRouter(prefix="/api/comeback", tags=["comeback"])


@router.get("/active")
def active():
    return {"triggers": store.recent(hours=24)}


@router.post("/ack")
def ack(body: dict):
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
