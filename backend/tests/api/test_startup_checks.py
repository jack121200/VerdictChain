"""Boot-time validation (BE9/SD5, backend/api/startup_checks.py): each problem is found, production aborts
with one message that lists them all, development only warns, and no message carries a secret.
"""

import asyncio
import logging
import time

import pytest
from fastapi.testclient import TestClient

from backend.api import startup_checks
from backend.api.main import app
from backend.api.startup_checks import StartupCheckError, collect_problems, run_startup_checks
from backend.config import Settings, settings

GOOD_SECRET = "k3y-" + "x9Qm2Lw7" * 6  # 52 characters, no placeholder marker
SENTINEL = "sentinel-secret-value-7731"


def _cfg(**overrides) -> Settings:
    base = {
        "environment": "production",
        "jwt_secret_key": GOOD_SECRET,
        "groq_api_key": "gsk_live_key_value",
        "gemini_api_key": "",
        "redis_url": "redis://127.0.0.1:6379/0",
    }
    return Settings(_env_file=None, **{**base, **overrides})


def _ok() -> None:
    return None


def _problems(cfg: Settings, *, postgres=_ok, redis_probe=lambda _cfg: None) -> list[str]:
    return collect_problems(cfg, postgres_probe=postgres, redis_probe=redis_probe)


def test_a_healthy_configuration_has_no_problems():
    assert _problems(_cfg()) == []
    assert _problems(_cfg(groq_api_key="", gemini_api_key="AIza_live_key_value")) == []


@pytest.mark.parametrize(
    ("secret", "expected"),
    [
        ("", "JWT_SECRET_KEY is not set"),
        ("   ", "JWT_SECRET_KEY is not set"),
        ("change_me_to_a_long_random_value", "placeholder"),
        ("Secret", "placeholder"),
        ("<paste a secret here>", "placeholder"),
        ("short-but-not-a-placeholder", "shorter than 32"),
    ],
)
def test_a_missing_placeholder_or_short_jwt_secret_is_a_problem(secret, expected):
    problems = _problems(_cfg(jwt_secret_key=secret))

    assert len(problems) == 1
    assert problems[0].startswith("JWT_SECRET_KEY") and expected in problems[0]


def test_an_unreachable_postgres_is_a_problem_named_by_exception_class():
    problems = _problems(_cfg(), postgres=lambda: "OperationalError")

    assert problems == ["PostgreSQL did not answer SELECT 1 (OperationalError)"]


def test_an_unreachable_redis_is_a_problem_named_by_exception_class():
    problems = _problems(_cfg(), redis_probe=lambda _cfg: "ConnectionError")

    assert problems == ["Redis did not answer PING (ConnectionError)"]


@pytest.mark.parametrize(
    "keys",
    [
        {"groq_api_key": "", "gemini_api_key": ""},
        {"groq_api_key": "your_groq_api_key_here", "gemini_api_key": "your_gemini_api_key_here"},
        {"groq_api_key": "  ", "gemini_api_key": ""},
    ],
)
def test_no_usable_llm_key_is_a_problem(keys):
    problems = _problems(_cfg(**keys))

    assert len(problems) == 1 and "GROQ_API_KEY" in problems[0] and "GEMINI_API_KEY" in problems[0]


def test_one_provider_key_is_enough():
    assert _problems(_cfg(groq_api_key="your_groq_api_key_here", gemini_api_key="AIza_live_key_value")) == []


def test_every_problem_is_listed_together_in_a_fixed_order():
    problems = _problems(
        _cfg(jwt_secret_key="", groq_api_key=""),
        postgres=lambda: "OperationalError",
        redis_probe=lambda _cfg: "ConnectionError",
    )

    assert [p.split(" ")[0] for p in problems] == ["JWT_SECRET_KEY", "PostgreSQL", "Redis", "no"]


def test_the_real_probes_report_only_the_exception_class_never_the_url():
    unreachable = _cfg(redis_url="redis://:pw-sentinel-5521@127.0.0.1:1/0")

    error = startup_checks._probe_redis(unreachable)

    assert error is not None and error.isidentifier() and "pw-sentinel-5521" not in error
    assert startup_checks._probe_redis(_cfg()) is None
    assert startup_checks._probe_postgres() is None  # the test database answers


def test_no_problem_text_contains_a_secret_value():
    cfg = _cfg(jwt_secret_key=SENTINEL[:20], groq_api_key="your_" + SENTINEL, gemini_api_key="")
    problems = _problems(cfg, postgres=lambda: "OperationalError")

    assert problems
    assert all(SENTINEL[:20] not in problem and SENTINEL not in problem for problem in problems)


def test_production_aborts_with_one_message_listing_every_problem(monkeypatch):
    monkeypatch.setattr(
        startup_checks, "collect_problems", lambda _cfg: ["first problem", "second problem", "third problem"]
    )

    with pytest.raises(StartupCheckError) as aborted:
        asyncio.run(run_startup_checks(_cfg(environment="production")))

    message = str(aborted.value)
    assert "3 startup check(s) failed" in message
    for number, problem in enumerate(["first problem", "second problem", "third problem"], start=1):
        assert f"{number}. {problem}" in message


def test_development_only_warns_for_each_problem_and_continues(monkeypatch, caplog):
    monkeypatch.setattr(startup_checks, "collect_problems", lambda _cfg: ["first problem", "second problem"])

    with caplog.at_level(logging.WARNING, logger=startup_checks.logger.name):
        asyncio.run(run_startup_checks(_cfg(environment="development")))  # must not raise

    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert warnings == ["startup check: first problem", "startup check: second problem"]


def test_a_clean_start_logs_nothing(monkeypatch, caplog):
    monkeypatch.setattr(startup_checks, "collect_problems", lambda _cfg: [])

    with caplog.at_level(logging.WARNING, logger=startup_checks.logger.name):
        asyncio.run(run_startup_checks(_cfg(environment="production")))

    assert caplog.records == []


def test_a_check_that_hangs_is_a_problem_not_a_hung_start(monkeypatch):
    monkeypatch.setattr(startup_checks, "STARTUP_CHECK_TIMEOUT_S", 0.05)
    monkeypatch.setattr(startup_checks, "collect_problems", lambda _cfg: time.sleep(0.5) or [])

    with pytest.raises(StartupCheckError, match="did not finish"):
        asyncio.run(run_startup_checks(_cfg(environment="production")))


def test_the_app_refuses_to_start_in_production_with_a_problem(monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(startup_checks, "collect_problems", lambda _cfg: ["JWT_SECRET_KEY is not set"])

    with pytest.raises(StartupCheckError, match="JWT_SECRET_KEY is not set"):
        with TestClient(app):
            pass


def test_the_app_starts_in_development_even_with_problems(monkeypatch):
    monkeypatch.setattr(settings, "environment", "development")
    monkeypatch.setattr(
        startup_checks, "collect_problems", lambda _cfg: ["no LLM provider key is configured"]
    )

    with TestClient(app) as running:
        assert running.get("/health").json() == {"status": "ok"}
