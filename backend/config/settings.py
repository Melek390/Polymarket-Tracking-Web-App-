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

    # Screener
    screener_refresh_minutes: int = 5

    # Polymarket public APIs
    gamma_base_url: str = "https://gamma-api.polymarket.com"
    clob_base_url: str = "https://clob.polymarket.com"

    log_level: str = "INFO"


settings = Settings()
