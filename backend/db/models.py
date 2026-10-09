import uuid
from datetime import datetime

from sqlalchemy import (
    REAL,
    BigInteger,
    Boolean,
    CheckConstraint,
    Float,
    ForeignKey,
    Identity,
    Index,
    Integer,
    SmallInteger,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import DOUBLE_PRECISION, JSONB, TIMESTAMP, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.sql import func


class Base(DeclarativeBase):
    pass


class RawLog(Base):
    __tablename__ = "raw_logs"
    __table_args__ = (
        Index("idx_raw_logs_timestamp", "timestamp"),
        Index("idx_raw_logs_source", "source"),
    )

    row_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    timestamp: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    source: Mapped[str] = mapped_column(Text, nullable=False)
    source_file: Mapped[str | None] = mapped_column(Text)
    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    user_id: Mapped[str | None] = mapped_column(Text)
    host_id: Mapped[str | None] = mapped_column(Text)
    severity: Mapped[str | None] = mapped_column(Text)
    raw_fields: Mapped[dict] = mapped_column(JSONB, nullable=False)
    ground_truth_label: Mapped[str | None] = mapped_column(Text)


class Investigation(Base):
    __tablename__ = "investigations"
    __table_args__ = (
        CheckConstraint("noise_pct IN (0, 15, 30)", name="ck_investigations_noise_pct"),
        Index("idx_investigations_created_at", "created_at"),
        Index("idx_investigations_status", "status"),
        Index("idx_investigations_queue", "queued_at", postgresql_where=text("status = 'queued'")),
    )

    investigation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    trigger_type: Mapped[str] = mapped_column(Text, nullable=False)
    trigger_reason: Mapped[str | None] = mapped_column(Text)
    scenario_label: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="investigating")
    verdict_class: Mapped[str | None] = mapped_column(Text)
    verdict_confidence: Mapped[float | None] = mapped_column(Float)
    noise_pct: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default=text("0"))
    effective_noise_pct: Mapped[float | None] = mapped_column(REAL)
    primary_agent: Mapped[str | None] = mapped_column(Text)
    # Debate queue (migration 0008): when it was accepted, and what the worker needs to run it later.
    queued_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    run_spec: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())


class DebateTranscript(Base):
    __tablename__ = "debate_transcripts"
    __table_args__ = (Index("idx_debate_transcripts_investigation", "investigation_id"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    investigation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("investigations.investigation_id")
    )
    round: Mapped[int] = mapped_column(Integer, nullable=False)
    agent_id: Mapped[str] = mapped_column(Text, nullable=False)
    theory: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    cited_evidence: Mapped[list] = mapped_column(JSONB, nullable=False)
    provider: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())


class CredibilityLog(Base):
    __tablename__ = "credibility_log"
    __table_args__ = (
        Index("idx_credibility_log_investigation_agent", "investigation_id", "agent_id"),
        Index("idx_credibility_log_agent_created", "agent_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    investigation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("investigations.investigation_id")
    )
    agent_id: Mapped[str] = mapped_column(Text, nullable=False)
    round: Mapped[int] = mapped_column(Integer, nullable=False)
    crs_before: Mapped[float] = mapped_column(Float, nullable=False)
    crs_after: Mapped[float] = mapped_column(Float, nullable=False)
    verification_match_rate: Mapped[float] = mapped_column(Float, nullable=False)
    isolated: Mapped[bool] = mapped_column(Boolean, server_default="false")
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())


class ResponseAction(Base):
    __tablename__ = "response_actions"
    __table_args__ = (
        Index("idx_response_actions_investigation", "investigation_id"),
        CheckConstraint("is_simulated = TRUE", name="ck_response_actions_always_simulated"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    investigation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("investigations.investigation_id")
    )
    action_type: Mapped[str] = mapped_column(Text, nullable=False)
    target: Mapped[str] = mapped_column(Text, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    is_simulated: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())


class ModelVersion(Base):
    __tablename__ = "model_versions"

    version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    trained_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())
    accuracy: Mapped[float | None] = mapped_column(Float)
    false_positive_rate: Mapped[float | None] = mapped_column(Float)
    is_deployed: Mapped[bool] = mapped_column(Boolean, server_default="false")
    notes: Mapped[str | None] = mapped_column(Text)


class AuditTrail(Base):
    __tablename__ = "audit_trail"
    __table_args__ = (
        Index("idx_audit_trail_investigation", "investigation_id"),
        Index("idx_audit_trail_created_at", "created_at"),
        Index("uq_audit_trail_seq", "seq", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    # The chain order. Assigned by the database at INSERT, never set by the application.
    seq: Mapped[int] = mapped_column(BigInteger, Identity(always=True), nullable=False)
    investigation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("investigations.investigation_id")
    )
    actor: Mapped[str] = mapped_column(Text, nullable=False)
    action: Mapped[str] = mapped_column(Text, nullable=False)
    detail: Mapped[dict | None] = mapped_column(JSONB)
    prev_hash: Mapped[str | None] = mapped_column(Text)
    entry_hash: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())


class AnalystFeedback(Base):
    __tablename__ = "analyst_feedback"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    investigation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("investigations.investigation_id")
    )
    verdict_was_correct: Mapped[bool] = mapped_column(Boolean, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())


class Analyst(Base):
    """Not in the original locked schema - added in Module 7 to satisfy
    SKILL-security.md Section 2's JWT auth requirement. See migration 0002.
    `role` was added in migration 0004 (plan section 3.1).
    """

    __tablename__ = "analysts"
    __table_args__ = (
        CheckConstraint(
            "role IN ('secops_lead', 'forensic_analyst', 'red_team_auditor', 'watchdog_supervisor')",
            name="ck_analysts_role",
        ),
    )

    analyst_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    username: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False, server_default="forensic_analyst")
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())


class RuntimeSettings(Base):
    """Single-row runtime configuration (migration 0004). id is pinned to 1."""

    __tablename__ = "runtime_settings"
    __table_args__ = (
        CheckConstraint("id = 1", name="ck_runtime_settings_singleton"),
        CheckConstraint("eta BETWEEN 0.01 AND 0.5", name="ck_runtime_settings_eta"),
        CheckConstraint(
            "isolation_threshold BETWEEN 0.05 AND 0.45", name="ck_runtime_settings_isolation_threshold"
        ),
        CheckConstraint(
            "verdict_confidence_threshold BETWEEN 0.50 AND 0.99", name="ck_runtime_settings_verdict_threshold"
        ),
    )

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, autoincrement=False)
    eta: Mapped[float] = mapped_column(DOUBLE_PRECISION, nullable=False, server_default=text("0.20"))
    isolation_threshold: Mapped[float] = mapped_column(
        DOUBLE_PRECISION, nullable=False, server_default=text("0.30")
    )
    verdict_confidence_threshold: Mapped[float] = mapped_column(
        DOUBLE_PRECISION, nullable=False, server_default=text("0.80")
    )
    intake_paused: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    updated_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_by: Mapped[str | None] = mapped_column(Text)


class AgentQuarantine(Base):
    """Persistent isolation state per investigator agent (migration 0006)."""

    __tablename__ = "agent_quarantine"
    __table_args__ = (
        CheckConstraint(
            "agent_id IN ('network_traffic', 'access_log', 'endpoint_behavior')",
            name="ck_agent_quarantine_agent_id",
        ),
    )

    agent_id: Mapped[str] = mapped_column(Text, primary_key=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    reason: Mapped[str | None] = mapped_column(Text)
    set_by: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())
