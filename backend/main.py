"""App entrypoint — one process serving the REST API, the built frontend,
and the always-on collector. Run with: uvicorn backend.main:app"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.api.routes import router
from backend.collector import scheduler
from backend.config.settings import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: create tables and start the polling jobs. Shutdown: stop them."""
    logging.basicConfig(level=settings.log_level)
    scheduler.start()
    yield
    scheduler.stop()


app = FastAPI(title="Polymarket Price Tracker", lifespan=lifespan)


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
app.include_router(router)


# The frontend uses real paths (not hashes), so a page opened directly at
# /screener or /market/12 must return the app shell instead of a 404.
@app.get("/screener")
@app.get("/screener/{sport}")
@app.get("/market/{market_id}")
def spa_page(sport: str = "", market_id: int = 0):
    """Serve index.html for the app's own page routes."""
    return FileResponse("frontend/dist/index.html")


# The pre-built React bundle, served from the same port so a single
# systemd service is the whole deployment. html=True maps / to index.html.
app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="frontend")
