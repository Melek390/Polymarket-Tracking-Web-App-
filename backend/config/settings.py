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

    log_level: str = "INFO"


settings = Settings()
