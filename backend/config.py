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

    # OpenAI is the only LLM provider, for every debate (manual injections and the live feed) and for the
    # sentence written with a containment action. Owner's decision of 2026-10-11: Groq and Gemini are gone.
    openai_api_key: str = ""
    openai_model: str = "gpt-4.1-mini"  # the owner's choice goes in OPENAI_MODEL (.env)
    # per call; a model that thinks first needs room, because its thinking counts against this number
    openai_max_output_tokens: int = 3000
    # Hard budget: input + output tokens the API may be asked for in any rolling 24 hours. A call that would
    # start above it is refused before any request leaves the machine (calls in flight may overshoot a bit).
    # One debate is 30,000 to 55,000 tokens, so this is room for about forty to sixty of them a day.
    openai_daily_token_limit: int = 2_000_000

    jwt_secret_key: str = ""
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60

    # Daily caps on debate runs (plan §3.5): per analyst and across all analysts. They are the second guard:
    # the cost of a day is bounded by openai_daily_token_limit, which a few dozen debates would reach anyway.
    debate_daily_limit_user: int = 30
    debate_daily_limit_global: int = 120
    # How many investigators the debate graph runs at once in a round (1 = one after the other). The provider
    # clients space their own calls, so a higher number cannot flood a provider.
    debate_max_parallel_agents: int = 3
    # How many debates run at once (backend/api/debate_queue.py, slots in backend/api/rate_limit.py). Each one
    # runs its three investigators side by side, so 4 debates are about 12 requests in flight: fine for a
    # funded OpenAI key, far too many for a free-tier one (set 1 there). The credibility scores are updated
    # atomically, so parallel debates share them safely.
    debate_max_concurrent: int = 4
    # Debates waiting for a free slot (backend/api/debate_queue.py): per analyst and in total.
    debate_queue_max_per_user: int = 3
    debate_queue_max_total: int = 10

    # Simulated live feed (backend/pipeline/live_feed.py, live_monitor.py, api/live_runner.py).
    live_feed_autostart: bool = False  # start the feed when the API starts
    live_feed_events_per_second: float = 4.0
    live_feed_attack_share: float = 0.2  # share of replayed segments that are taken from a scenario
    live_feed_queue: str = "live_log_events"  # RabbitMQ queue; give each environment its own
    live_auto_investigate: bool = True  # a flagged window starts an investigation by itself
    live_min_gap_seconds: int = 20  # between two automatic investigations from the same source window
    live_max_queued: int = 4  # automatic investigations that may wait for a free debate slot at once
    live_daily_cap: int = 80  # automatic investigations per 24 hours (they also count in the global cap)
    # The live feed makes no model call before it has streamed this many rows (the monitor's own scoring is
    # local and free, so it runs from row 1). The Live page chooses the value per run; this is the default.
    live_llm_after_rows: int = 1500

    # First SecOps Lead, created by `python -m backend.scripts.bootstrap_lead` (plan §3.6).
    bootstrap_lead_username: str = ""
    bootstrap_lead_password: str = ""

    @property
    def sqlalchemy_url(self) -> str:
        raw = self.database_url if self.environment == "production" else self.local_database_url
        return _with_psycopg_driver(raw)


settings = Settings()
