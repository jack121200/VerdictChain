from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_ROOT_ENV = Path(__file__).resolve().parent.parent / ".env"


def _with_psycopg_driver(url: str) -> str:
    """Neon/Supabase hand us plain postgresql:// URLs; we run psycopg3, not psycopg2."""
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ROOT_ENV, extra="ignore")

    environment: str = "development"

    database_url: str = ""
    local_database_url: str = ""
    # Test-only. The pytest suite uses this database when set, and refuses to run if the
    # effective database is the dev DB (backend/tests/conftest.py). The app never reads it.
    test_database_url: str = ""

    redis_url: str = "redis://127.0.0.1:6379/0"
    rabbitmq_url: str = "amqp://guest:guest@127.0.0.1:5672/"

    groq_api_key: str = ""
    gemini_api_key: str = ""

    jwt_secret_key: str = ""
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60

    # Daily caps on debate runs (plan §3.5): per analyst and across all analysts.
    debate_daily_limit_user: int = 10
    debate_daily_limit_global: int = 20

    # First SecOps Lead, created by `python -m backend.scripts.bootstrap_lead` (plan §3.6).
    bootstrap_lead_username: str = ""
    bootstrap_lead_password: str = ""

    @property
    def sqlalchemy_url(self) -> str:
        raw = self.database_url if self.environment == "production" else self.local_database_url
        return _with_psycopg_driver(raw)


settings = Settings()
