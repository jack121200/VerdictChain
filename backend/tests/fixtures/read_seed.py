"""ORM seeding helpers for the read-endpoint tests (W1-C). They only INSERT. Nothing here UPDATEs or DELETEs
audit_trail. Callers commit. Imported only by tests, after conftest.py has pointed the engine at the test DB.
"""

import uuid
from datetime import datetime, timedelta, timezone

import redis

from backend.api.auth import create_access_token
from backend.config import settings
from backend.db.audit import append_entry
from backend.db.models import (
    AgentQuarantine,
    AnalystFeedback,
    AuditTrail,
    CredibilityLog,
    DebateTranscript,
    Investigation,
    RawLog,
    ResponseAction,
)
from backend.db.session import SessionLocal
from backend.tests.fixtures.auth import make_analyst

BASE_TIME = datetime(2026, 1, 15, 12, 0, tzinfo=timezone.utc)


def ago(*, minutes: int = 0, hours: int = 0) -> datetime:
    return datetime.now(timezone.utc) - timedelta(minutes=minutes, hours=hours)


def add_raw(
    session,
    *,
    source: str = "cicids2017",
    event_type: str = "network_flow",
    user_id: str | None = None,
    host_id: str | None = None,
    raw_fields: dict | None = None,
    label: str | None = None,
    timestamp: datetime | None = None,
) -> RawLog:
    row = RawLog(
        timestamp=timestamp or BASE_TIME,
        source=source,
        source_file=f"{source}.csv",
        event_type=event_type,
        user_id=user_id,
        host_id=host_id,
        severity=None,
        raw_fields=raw_fields if raw_fields is not None else {"Destination Port": 445},
        ground_truth_label=label,
    )
    session.add(row)
    session.flush()
    return row


def add_investigation(
    session,
    *,
    status: str = "verdict_reached",
    verdict_class: str | None = "ddos",
    confidence: float | None = 0.9,
    scenario_label: str | None = None,
    primary_agent: str | None = "network_traffic",
    noise_pct: int = 0,
    created_at: datetime | None = None,
    trigger_type: str = "manual",
) -> Investigation:
    inv = Investigation(
        trigger_type=trigger_type,
        status=status,
        verdict_class=verdict_class,
        verdict_confidence=confidence,
        scenario_label=scenario_label,
        primary_agent=primary_agent,
        noise_pct=noise_pct,
        effective_noise_pct=float(noise_pct) if noise_pct else None,
        created_at=created_at or ago(hours=1),
    )
    session.add(inv)
    session.flush()
    return inv


def add_transcript(
    session,
    investigation_id: uuid.UUID,
    *,
    round_no: int,
    agent_id: str,
    theory: str,
    confidence: float = 0.8,
    cited: list[dict] | None = None,
    provider: str | None = "groq",
) -> DebateTranscript:
    row = DebateTranscript(
        investigation_id=investigation_id,
        round=round_no,
        agent_id=agent_id,
        theory=theory,
        confidence=confidence,
        cited_evidence=cited or [],
        provider=provider,
    )
    session.add(row)
    session.flush()
    return row


def cite(row: RawLog, field: str, value: str, row_id: str | None = None) -> dict:
    return {"row_id": row_id or str(row.row_id), "field": field, "value": value}


def add_credibility(
    session,
    investigation_id: uuid.UUID,
    *,
    agent_id: str,
    round_no: int,
    before: float,
    after: float,
    rate: float,
    isolated: bool = False,
    created_at: datetime | None = None,
) -> CredibilityLog:
    row = CredibilityLog(
        investigation_id=investigation_id,
        agent_id=agent_id,
        round=round_no,
        crs_before=before,
        crs_after=after,
        verification_match_rate=rate,
        isolated=isolated,
        created_at=created_at or BASE_TIME,
    )
    session.add(row)
    session.flush()
    return row


def add_action(
    session,
    investigation_id: uuid.UUID | None,
    *,
    action_type: str = "lock_account",
    target: str = "u1",
    is_simulated: bool = True,
) -> ResponseAction:
    row = ResponseAction(
        investigation_id=investigation_id,
        action_type=action_type,
        target=target,
        reason="test reason",
        is_simulated=is_simulated,
    )
    session.add(row)
    session.flush()
    return row


def add_feedback(session, investigation_id: uuid.UUID, correct: bool) -> AnalystFeedback:
    row = AnalystFeedback(investigation_id=investigation_id, verdict_was_correct=correct)
    session.add(row)
    session.flush()
    return row


def audit(
    session,
    actor: str,
    action: str,
    detail: dict | None = None,
    investigation_id: uuid.UUID | None = None,
    created_at: datetime | None = None,
) -> AuditTrail:
    """Appends through the real append_entry. created_at is set before the row is flushed."""
    entry = append_entry(
        session, actor=actor, action=action, detail=detail, investigation_id=investigation_id
    )
    if created_at is not None:
        entry.created_at = created_at
    return entry


def set_quarantine(session, agent_id: str, active: bool) -> None:
    row = session.get(AgentQuarantine, agent_id)
    row.active = active
    session.flush()


def clear_crs_keys() -> None:
    """Removes the Redis CrS and isolation keys so each test starts from the starting value."""
    client = redis.Redis.from_url(settings.redis_url, decode_responses=True)
    for key in list(client.scan_iter("verdictchain:crs:*")) + list(
        client.scan_iter("verdictchain:isolated:*")
    ):
        client.delete(key)


def new_session():
    return SessionLocal()


def bearer_for(role: str) -> dict[str, str]:
    """A real analyst row with `role` and a JWT for it. No /auth/login call, so no login audit entry."""
    analyst = make_analyst(role)
    return {"Authorization": f"Bearer {create_access_token(analyst.username, role)}"}
