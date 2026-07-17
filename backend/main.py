"""App entrypoint — one process serving the REST API, the built frontend,
and the always-on collector. Run with: uvicorn backend.main:app"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
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

# JSON API under /api/... (see backend/api/routes.py)
app.include_router(router)

# The pre-built React bundle, served from the same port so a single
# systemd service is the whole deployment. html=True maps / to index.html.
app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="frontend")
