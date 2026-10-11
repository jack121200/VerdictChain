from backend.config import Settings

_NEW_ENV_NAMES = (
    "TEST_DATABASE_URL",
    "DEBATE_DAILY_LIMIT_USER",
    "DEBATE_DAILY_LIMIT_GLOBAL",
    "BOOTSTRAP_LEAD_USERNAME",
    "BOOTSTRAP_LEAD_PASSWORD",
)


def test_new_fields_have_their_documented_defaults(monkeypatch):
    for name in _NEW_ENV_NAMES:
        monkeypatch.delenv(name, raising=False)
    settings = Settings(_env_file=None)  # defaults only, independent of the developer's .env
    assert settings.test_database_url == ""
    assert settings.debate_daily_limit_user == 30
    assert settings.debate_daily_limit_global == 120
    assert settings.bootstrap_lead_username == ""
    assert settings.bootstrap_lead_password == ""


def test_new_fields_read_from_the_environment(monkeypatch):
    monkeypatch.setenv("DEBATE_DAILY_LIMIT_USER", "3")
    monkeypatch.setenv("BOOTSTRAP_LEAD_USERNAME", "lead_from_env")
    settings = Settings(_env_file=None)
    assert settings.debate_daily_limit_user == 3
    assert settings.bootstrap_lead_username == "lead_from_env"
