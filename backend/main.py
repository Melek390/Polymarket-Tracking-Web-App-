"""App entrypoint — one process serving the REST API, the built frontend,
and the always-on collector. Run with: uvicorn backend.main:app"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.api.routes import router
from backend.auth import deps as auth_deps
from backend.auth import store as auth_store
from backend.auth.api import router as auth_router
from backend.backtest.api import router as backtest_router
from backend.backtest import store as backtest_store
from backend.bottom8.api import router as bottom8_router
from backend.bottom8 import store as bottom8_store
from backend.comeback.api import router as comeback_router
from backend.comeback import store as comeback_store
from backend.favorite.api import router as favorite_router
from backend.favorite import store as favorite_store
from backend.football.api import router as football_router
from backend.football import store as football_store
from backend.traders.api import router as traders_router
from backend.traders import store as traders_store
from backend.collector import scheduler
from backend.config.settings import settings


# Two libraries log one INFO line per tick / per request, which on this app's
# cadence (jobs every 1-3s, a CLOB batch every 2s) was 230k lines a day — 70% of
# a journal that had grown to 897 MB on a 10 GB disk. WARNING keeps everything
# diagnostic: apscheduler still reports "maximum number of running instances
# reached", which is how the serial-poll overrun was found, and httpx still
# reports failures.
_QUIET_LOGGERS = ("apscheduler.executors.default", "apscheduler.scheduler", "httpx")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: create tables and start the polling jobs. Shutdown: stop them."""
    logging.basicConfig(level=settings.log_level)
    for name in _QUIET_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)
    traders_store.init()
    favorite_store.init()
    comeback_store.init()
    bottom8_store.init()
    football_store.init()
    backtest_store.init()
    auth_store.init()
    auth_store.purge_expired()
    if auth_store.user_count() == 0:
        logging.getLogger(__name__).warning(
            "auth: no accounts exist yet — create the first admin with "
            "`python scripts/create_admin.py <username>` or nobody can sign in")
    scheduler.start()
    yield
    scheduler.stop()


app = FastAPI(title="Polymarket Price Tracker", lifespan=lifespan)


@app.middleware("http")
async def require_auth(request, call_next):
    """Fail-closed gate. Every /api/ path needs a session unless it is on the
    allow-list in auth.deps.is_public(), so an endpoint added later is
    protected by default rather than accidentally exposed — which is exactly
    how this app spent months serving live data to the open internet.

    Non-API paths (the SPA shell, hashed assets) always pass: the browser has
    to be able to load the app in order to render the login page."""
    if settings.auth_enabled and not auth_deps.is_public(request.url.path):
        if not (auth_deps.has_health_token(request) or auth_deps.current_user(request)):
            return JSONResponse({"detail": "sign in to continue"}, status_code=401)
    return await call_next(request)


@app.middleware("http")
async def cache_headers(request, call_next):
    """Correct caching so live data is never stale and clients always run the
    latest build. API responses must not be cached (live prices/state); the
    content-hashed JS/CSS can be cached forever; index.html must be revalidated
    every load so a deploy's new bundle is picked up immediately (heuristic
    caching of index.html was serving old bundles -> 'prices don't update')."""
    resp = await call_next(request)
    path = request.url.path
    if path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    elif path.startswith("/assets/"):
        resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif resp.headers.get("content-type", "").startswith("text/html"):
        resp.headers["Cache-Control"] = "no-cache"
    return resp


# JSON API under /api/... (see backend/api/routes.py)
app.include_router(auth_router)
app.include_router(router)
app.include_router(traders_router)
app.include_router(favorite_router)
app.include_router(comeback_router)
app.include_router(bottom8_router)
app.include_router(football_router)
app.include_router(backtest_router)


# Heap forensics for the Aug 25 memory creep: token-guarded (the auth
# middleware covers /api like every other route). Cheap enough to call by
# hand; tracemalloc detail appears only when PYTHONTRACEMALLOC is set in
# the service environment.
@app.get("/api/debug/heap")
def debug_heap():
    import gc
    import tracemalloc
    from collections import Counter

    objs = gc.get_objects()
    top = Counter(type(o).__name__ for o in objs).most_common(40)
    out = {"objects": len(objs), "topTypes": top,
           "tracemalloc": None}
    if tracemalloc.is_tracing():
        snap = tracemalloc.take_snapshot()
        stats = snap.statistics("lineno")[:25]
        out["tracemalloc"] = [
            {"site": str(st.traceback[0]), "mb": round(st.size / 1e6, 1),
             "count": st.count} for st in stats]
        out["tracedMB"] = round(tracemalloc.get_traced_memory()[0] / 1e6, 1)
    return out


# The frontend uses real paths (not hashes), so a page opened directly at
# /screener or /market/12 must return the app shell instead of a 404.
@app.get("/screener")
@app.get("/screener/{sport}")
@app.get("/market/{market_id}")
@app.get("/accounts_tracker")
@app.get("/backtesting")
@app.get("/login")
@app.get("/register")
@app.get("/forgot")
@app.get("/reset")
@app.get("/admin")
@app.get("/account")
def spa_page(sport: str = "", market_id: int = 0):
    """Serve index.html for the app's own page routes."""
    return FileResponse("frontend/dist/index.html")


# The pre-built React bundle, served from the same port so a single
# systemd service is the whole deployment. html=True maps / to index.html.
app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="frontend")
