"""/api/football — soccer live data and the 0-0 alert.

  GET  /live        cached big-5 live fixtures + stats (score, minute,
                    possession, shots, shots on target, red cards)
  GET  /active      today's triggers (acked ones included, flagged)
  POST /ack         {"id": n} — checked; the flash stops, the tag stays
  GET  /config      current thresholds
  PUT  /config      partial update, unknown keys refused
  GET  /log?limit=  full history for review / backtesting
"""

from fastapi import APIRouter, HTTPException

from backend.football import live, store

router = APIRouter(prefix="/api/football", tags=["football"])


@router.get("/live")
def live_snapshot():
    return live.snapshot()


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
