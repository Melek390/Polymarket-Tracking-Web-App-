"""Application settings, loaded from .env (see .env.example)."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    # Server
    host: str = "0.0.0.0"
    port: int = 8000

    # Database
    db_path: str = "prices.db"

    # Collector
    default_poll_interval: int = 5  # seconds
    # MLB markets are polled faster: measuring the feed lag means correlating
    # price moves against play times, and at 5s sampling the lag (~5-10s) can't
    # be resolved. 1s sampling gives the resolution that measurement needs.
    mlb_poll_interval: int = 1
    http_timeout: float = 30.0
    max_retries: int = 5

    # Screener — how often the whole-sport match cache is rebuilt. This is a
    # heavy job (soccer alone is ~2k Gamma events), so it runs infrequently;
    # live rows get fresh CLOB prices on top of the cache anyway, so the cache
    # itself only needs to be roughly current, not real-time.
    screener_refresh_minutes: int = 15

    # MLB live game state poll (seconds); 3s catches every update (the MLB
    # feed itself only refreshes every 6-8s) at a tiny, safe request rate
    mlb_poll_seconds: int = 3

    # Server-side live-price poll (seconds). Browsers read the resulting cache,
    # so this — not the browser's refresh rate — sets how often we hit the CLOB
    # for a live game (once per cycle per viewed game, any number of viewers).
    live_price_poll_seconds: int = 2

    # Polymarket public APIs
    gamma_base_url: str = "https://gamma-api.polymarket.com"
    clob_base_url: str = "https://clob.polymarket.com"

    # Kill switch for ALL backtest background jobs (spots backfill, favorite
    # history, bottom-8 sweep, WE sweep). The v4 rebuild saturated the VM's
    # disk and froze the app (Aug 24); false = the site runs with zero
    # backtest load and sweeps only run when kicked manually.
    backtest_jobs_enabled: bool = True

    # API-FOOTBALL (api-sports.io) — soccer live data + the 0-0 alert. Empty
    # key = the soccer features stay dark, everything else runs normally.
    # Polling only happens while a big-5 match is inside its live window, so
    # the request budget is ~1/min for fixtures + 1 per live match per
    # stats interval — size the intervals to the plan's quota.
    football_api_key: str = ""
    football_poll_seconds: int = 60
    football_stats_seconds: int = 120

    # Auth. The public URL ran open for months (V2.md's biggest delivery
    # risk); this closes it. auth_enabled exists so a developer can run the
    # app locally without signing in — it must stay TRUE on the VM.
    auth_enabled: bool = True
    # Secure cookies require HTTPS. Production is behind HTTPS so the VM's
    # .env sets AUTH_COOKIE_SECURE=true; local testing is plain http and must
    # leave it false or the browser silently drops the login cookie.
    auth_cookie_secure: bool = False
    auth_session_days: int = 30
    auth_invite_days: int = 7
    auth_reset_hours: int = 4
    # scripts/healthcheck.py runs on the box with no browser and no cookie, so
    # once auth is on every one of its 27 checks would 401. It sends this
    # shared secret in X-Health-Token instead. Empty = no bypass exists at
    # all (fail closed); the VM's .env sets a long random value.
    auth_health_token: str = ""

    log_level: str = "INFO"


settings = Settings()
