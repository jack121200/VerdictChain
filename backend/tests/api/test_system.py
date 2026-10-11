import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

import redis
from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from backend.agents.llm_clients import OpenAIClient, model_name
from backend.api.main import app
from backend.api.rate_limit import DEBATE_SLOT_KEY, DebateSlot
from backend.api.routes import system
from backend.config import settings
from backend.db import runtime_settings
from backend.db.models import DebateTranscript, ResponseAction
from backend.db.session import SessionLocal
from backend.tests.fixtures.auth import auth_headers

client = TestClient(app)
BACKEND_DIR = Path(__file__).resolve().parents[2]
LLM_CLIENTS_SOURCE = BACKEND_DIR / "agents" / "llm_clients.py"
MIGRATIONS_DIR = BACKEND_DIR / "db" / "migrations"
METRIC_KEYS = {"value", "n", "as_of", "source", "definition", "reason"}


def _get_status(headers: dict[str, str]) -> dict:
    resp = client.get("/system/status", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _numbers_outside_metrics(node, path: str = "$") -> list[str]:
    """Every JSON number must sit in a Metric envelope (its `value` or `n`). Returns the paths that do not."""
    if isinstance(node, dict):
        is_metric = METRIC_KEYS <= set(node)
        found: list[str] = []
        for key, child in node.items():
            if is_metric and key in ("value", "n"):
                continue
            found += _numbers_outside_metrics(child, f"{path}.{key}")
        return found
    if isinstance(node, list):
        return [p for i, child in enumerate(node) for p in _numbers_outside_metrics(child, f"{path}[{i}]")]
    if isinstance(node, int | float) and not isinstance(node, bool):
        return [path]
    return []


def _all_metrics(node) -> list[dict]:
    if isinstance(node, dict):
        if METRIC_KEYS <= set(node):
            return [node]
        return [m for child in node.values() for m in _all_metrics(child)]
    if isinstance(node, list):
        return [m for child in node for m in _all_metrics(child)]
    return []


def test_status_needs_a_token(db_session):
    resp = client.get("/system/status")
    assert resp.status_code == 401
    assert resp.headers["www-authenticate"] == "Bearer"


def test_the_three_services_report_ok_with_a_measured_latency(db_session):
    body = _get_status(auth_headers("forensic_analyst"))
    for name in ("postgres", "redis", "rabbitmq"):
        service = body[name]
        assert service["ok"] is True, (name, service)
        assert service["error_class"] is None
        assert service["latency_ms"]["value"] > 0
        assert service["latency_ms"]["n"] == 1
        assert service["latency_ms"]["reason"] is None


def test_providers_report_configured_models_and_temperature(db_session):
    body = _get_status(auth_headers("forensic_analyst"))
    assert list(body["providers"]) == ["openai"]  # the one provider
    assert body["providers"]["openai"]["model"] == model_name()
    assert body["providers"]["openai"]["configured"] is bool(settings.openai_api_key.strip())
    assert body["providers"]["openai"]["temperature"]["value"] == 0.2
    assert OpenAIClient.name == "openai"


def test_temperature_constant_matches_the_client_in_the_source():
    source = LLM_CLIENTS_SOURCE.read_text(encoding="utf-8")
    assert source.count('"temperature": 0.2') == 1
    assert system.LLM_TEMPERATURE == 0.2


def test_calls_24h_counts_only_rows_from_the_last_24_hours(db_session):
    now = datetime.now(timezone.utc)

    def row(provider: str | None, created_at: datetime) -> DebateTranscript:
        return DebateTranscript(
            round=1,
            agent_id="network_traffic",
            theory="CHALLENGE the timeline",
            confidence=0.6,
            cited_evidence=[],
            provider=provider,
            created_at=created_at,
        )

    with SessionLocal() as session:
        session.add_all(
            [
                row("openai", now - timedelta(hours=1)),
                row("openai", now - timedelta(hours=2)),
                row("openai", now - timedelta(hours=3)),
                row("openai", now - timedelta(hours=30)),  # outside the window
                row("stub-openai", now - timedelta(hours=1)),  # the offline stub is not the provider
                row(None, now),  # no provider recorded: counted for neither
            ]
        )
        session.commit()

    body = _get_status(auth_headers("forensic_analyst"))
    calls = body["providers"]["openai"]["calls_24h"]
    assert (calls["value"], calls["n"], calls["reason"]) == (3, 3, None)


def test_zero_calls_is_a_real_zero_not_a_null(db_session):
    calls = _get_status(auth_headers("forensic_analyst"))["providers"]["openai"]["calls_24h"]
    assert calls["value"] == 0
    assert calls["reason"] is None


def test_sandbox_counts_actions_and_no_action_is_unsimulated(db_session):
    with SessionLocal() as session:
        session.add_all(
            [
                ResponseAction(action_type="lock_account", target="user_a"),
                ResponseAction(action_type="block_ip_range", target="10.0.0.0/24"),
            ]
        )
        session.commit()
    sandbox = _get_status(auth_headers("forensic_analyst"))["sandbox"]
    assert (sandbox["actions_total"]["value"], sandbox["actions_total"]["n"]) == (2, 2)
    assert (sandbox["is_simulated_violations"]["value"], sandbox["is_simulated_violations"]["n"]) == (0, 2)


def _slot_summary(headers) -> tuple[str, str | None, int | None, int, list[str]]:
    slot = _get_status(headers)["debate_slot"]
    return (
        slot["status"],
        slot["investigation_id"],
        slot["running"]["value"],
        slot["capacity"]["value"],
        slot["investigation_ids"],
    )


def test_debate_slot_is_idle_with_no_holder_and_running_with_one_or_more(db_session, monkeypatch):
    monkeypatch.setattr(settings, "debate_max_concurrent", 3)
    headers = auth_headers("forensic_analyst")
    client_redis = redis.Redis.from_url(settings.redis_url, decode_responses=True)
    client_redis.delete(DEBATE_SLOT_KEY)
    slots: list[DebateSlot] = []
    try:
        assert _slot_summary(headers) == ("idle", None, 0, 3, [])
        ids = [str(uuid.uuid4()) for _ in range(2)]
        for investigation in ids:
            slot = DebateSlot()
            assert slot.acquire()
            slot.bind(investigation)
            slots.append(slot)
            time.sleep(0.01)  # slots are ordered by the millisecond they were taken
        status, first, running, capacity, listed = _slot_summary(headers)
        assert (status, running, capacity) == ("running", 2, 3)
        assert listed == ids and first == ids[0]  # longest-running first
        # A debate that is still starting holds a pending token: it counts as running but has no id yet.
        starting = DebateSlot()
        assert starting.acquire()
        slots.append(starting)
        assert _slot_summary(headers)[2:] == (3, 3, ids)
    finally:
        for slot in slots:
            slot.release()
        client_redis.delete(DEBATE_SLOT_KEY)
        client_redis.close()


def test_intake_paused_follows_the_stored_setting(db_session):
    with SessionLocal() as session:
        runtime_settings.save(
            session,
            {
                "eta": 0.15,
                "isolation_threshold": 0.30,
                "verdict_confidence_threshold": 0.80,
                "intake_paused": True,
            },
            updated_by="tester",
        )
        session.commit()
    assert _get_status(auth_headers("forensic_analyst"))["intake_paused"] is True


def test_flags_api_version_and_migration_head(db_session):
    body = _get_status(auth_headers("forensic_analyst"))
    assert body["continuous_mode"] is False
    assert body["api_version"] == "2.4.0"
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    assert body["migration_head"] == ScriptDirectory.from_config(config).get_current_head()


def test_no_secret_or_connection_string_appears_in_the_response(db_session, monkeypatch):
    headers = auth_headers("forensic_analyst")  # log in before the secrets are swapped for sentinels
    monkeypatch.setattr(settings, "openai_api_key", "sk-sentinel-key-000111222333")
    secrets = [settings.openai_api_key, settings.jwt_secret_key]
    for url in (
        settings.local_database_url,
        settings.database_url,
        settings.rabbitmq_url,
        settings.redis_url,
    ):
        password = urlsplit(url).password
        secrets.append(password or "")
    secrets = [value for value in secrets if value and len(value) >= 12]
    assert "sk-sentinel-key-000111222333" in secrets

    resp = client.get("/system/status", headers=headers)
    text = resp.text
    assert resp.json()["providers"]["openai"]["configured"] is True
    for value in secrets:
        assert value not in text
    assert "://" not in text
    assert "redis://" not in text and "amqp" not in text.lower() and "postgresql" not in text.lower()


def test_a_probe_failure_reports_the_class_name_and_not_the_message(db_session, monkeypatch):
    headers = auth_headers("forensic_analyst")
    monkeypatch.setattr(settings, "rabbitmq_url", "amqp://guest:TOPSECRETPASS987@127.0.0.1:1/")
    resp = client.get("/system/status", headers=headers)
    body = resp.json()
    assert body["rabbitmq"]["ok"] is False
    assert body["rabbitmq"]["error_class"] and "TOPSECRETPASS987" not in body["rabbitmq"]["error_class"]
    assert body["rabbitmq"]["latency_ms"]["value"] is None
    assert body["rabbitmq"]["latency_ms"]["reason"].startswith("probe failed: ")
    assert "TOPSECRETPASS987" not in resp.text


def test_a_redis_failure_marks_the_debate_slot_unavailable(db_session, monkeypatch):
    headers = auth_headers("forensic_analyst")  # authenticated before Redis is pointed at a closed port
    monkeypatch.setattr(settings, "redis_url", "redis://127.0.0.1:1/0")
    body = _get_status(headers)
    assert body["redis"]["ok"] is False
    assert body["redis"]["error_class"] is not None
    slot = body["debate_slot"]
    assert (slot["status"], slot["investigation_id"], slot["investigation_ids"]) == ("unavailable", None, [])
    assert slot["running"]["value"] is None and slot["running"]["reason"] == "Redis could not be read"
    assert slot["capacity"]["value"] == settings.debate_max_concurrent


def test_a_slow_probe_is_cut_off_at_the_budget(db_session, monkeypatch):
    headers = auth_headers("forensic_analyst")

    def slow_probe() -> system._Probe:
        time.sleep(4)
        return system._Probe(True, 1.0, None)

    # Time is measured inside the route, at the moment the response object is built. The TestClient
    # teardown would otherwise add the sleeping probe thread's remaining time to the measurement.
    real_status_out = system.SystemStatusOut
    built_at: dict[str, float] = {}

    def stamping_status_out(**kwargs):
        built_at["t"] = time.perf_counter()
        return real_status_out(**kwargs)

    monkeypatch.setattr(system, "_probe_rabbitmq", slow_probe)
    monkeypatch.setattr(system, "SystemStatusOut", stamping_status_out)
    started = time.perf_counter()
    resp = client.get("/system/status", headers=headers)
    assert resp.status_code == 200
    assert built_at["t"] - started < 3.0, built_at["t"] - started
    assert resp.json()["rabbitmq"]["ok"] is False
    assert resp.json()["rabbitmq"]["error_class"] == "timeout"


def test_an_unreadable_database_nulls_the_database_metrics_with_reasons(db_session, monkeypatch):
    headers = auth_headers("forensic_analyst")

    def broken_stats():
        raise OperationalError("SELECT count(*)", {}, Exception("simulated outage"))

    monkeypatch.setattr(system, "_read_db_stats", broken_stats)
    body = _get_status(headers)
    assert body["intake_paused"] is None
    for metric in (
        body["providers"]["openai"]["calls_24h"],
        body["sandbox"]["actions_total"],
        body["sandbox"]["is_simulated_violations"],
    ):
        assert metric["value"] is None
        assert metric["reason"]


def test_every_number_in_the_status_sits_inside_a_metric_envelope(db_session):
    body = _get_status(auth_headers("forensic_analyst"))
    assert _numbers_outside_metrics(body) == []
    metrics = _all_metrics(body)
    # three latencies, one temperature, one calls_24h, one call time, one quota count, two sandbox counts,
    # the four numbers OpenAI itself reports about this key (requests and tokens, left and allowed), and
    # the two debate-slot numbers (running now, capacity)
    assert len(metrics) == 15
    for metric in metrics:
        assert metric["n"] >= 0
        assert (metric["value"] is None) == (metric["reason"] is not None), metric
