"""Headline metrics (plan sections 2 and 3.4): every KPI is a Metric envelope with its n and definition.

Empty database: every rate and average is null with a reason, and every count is a real 0 (plan R2).
The whole audit chain is verified on each call. Citations are re-checked against raw_logs on each call.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.api.auth import get_current_user
from backend.api.metrics import Metric, make_metric
from backend.api.routes.evidence import load_investigation_citations
from backend.api.schemas.stats import (
    ChainStatsOut,
    CitationStatsOut,
    FeedbackStatsOut,
    LatencyStatsOut,
    SelfHealingStatsOut,
    StatsOut,
    WatchdogStatsOut,
)
from backend.db.audit import find_first_break
from backend.db.models import (
    AnalystFeedback,
    AuditTrail,
    CredibilityLog,
    DebateTranscript,
    Investigation,
    ResponseAction,
)
from backend.db.session import SessionLocal
from backend.evaluation.ground_truth_map import ATTACK_CLASSES, INSIDER_CLASSES, VERDICT_CLASSES
from backend.watchdog.credibility import get_crs

router = APIRouter(prefix="/stats", tags=["stats"])

SOURCE = "/stats"
INVESTIGATOR_IDS = ("network_traffic", "access_log", "endpoint_behavior")
ACTIVE_WINDOW = timedelta(minutes=30)
THREAT_WINDOW = timedelta(hours=24)
THREAT_STATUSES = ("verdict_reached", "contained")
VERDICT_STATUSES = ("verdict_reached", "contained", "ambiguous")
KNOWN_STATUSES = ("investigating", "verdict_reached", "contained", "ambiguous", "error")


def _count(value: int, definition: str) -> Metric[int]:
    return make_metric(value, value, SOURCE, definition)


def _share(numerator: int, denominator: int, definition: str, empty_reason: str) -> Metric[float]:
    return make_metric(
        numerator / denominator if denominator else None,
        denominator,
        SOURCE,
        definition,
        reason=None if denominator else empty_reason,
    )


def _investigation_count(session: Session, *conditions) -> int:
    return session.execute(select(func.count()).select_from(Investigation).where(*conditions)).scalar_one()


def _investigation_block(session: Session, now: datetime) -> dict:
    status_counts = dict(
        session.execute(select(Investigation.status, func.count()).group_by(Investigation.status)).all()
    )
    verdict_counts = dict(
        session.execute(
            select(Investigation.verdict_class, func.count())
            .where(Investigation.verdict_class.is_not(None))
            .group_by(Investigation.verdict_class)
        ).all()
    )
    by_status = {
        s: _count(status_counts.get(s, 0), f"investigations with status {s}") for s in KNOWN_STATUSES
    }
    for status, count in status_counts.items():
        by_status.setdefault(status, _count(count, f"investigations with status {status}"))
    by_verdict = {
        c: _count(verdict_counts.get(c, 0), f"investigations with verdict {c}") for c in VERDICT_CLASSES
    }
    for verdict, count in verdict_counts.items():
        by_verdict.setdefault(verdict, _count(count, f"investigations with verdict {verdict}"))

    mean_conf, n_conf = session.execute(
        select(
            func.avg(Investigation.verdict_confidence), func.count(Investigation.verdict_confidence)
        ).where(Investigation.verdict_confidence.is_not(None), Investigation.status.in_(VERDICT_STATUSES))
    ).one()
    return {
        "active": _count(
            _investigation_count(
                session,
                Investigation.status == "investigating",
                Investigation.created_at > now - ACTIVE_WINDOW,
            ),
            "investigations still investigating and created within the last 30 minutes",
        ),
        "stale": _count(
            _investigation_count(
                session,
                Investigation.status == "investigating",
                Investigation.created_at <= now - ACTIVE_WINDOW,
            ),
            "investigations still investigating and created more than 30 minutes ago",
        ),
        "threats_24h": _count(
            _investigation_count(
                session,
                Investigation.verdict_class.in_(sorted(ATTACK_CLASSES)),
                Investigation.status.in_(THREAT_STATUSES),
                Investigation.created_at >= now - THREAT_WINDOW,
            ),
            "threat verdicts (six attack classes, status verdict_reached or contained) created in 24 h",
        ),
        "insider_count": _count(
            _investigation_count(
                session,
                Investigation.verdict_class.in_(sorted(INSIDER_CLASSES)),
                Investigation.status.in_(THREAT_STATUSES),
            ),
            "insider verdicts (insider_file_exfiltration or insider_logon_anomaly), all time",
        ),
        "contained": _count(
            _investigation_count(session, Investigation.status == "contained"),
            "investigations with status contained",
        ),
        "by_status": by_status,
        "by_verdict_class": by_verdict,
        "mean_agent_confidence": make_metric(
            float(mean_conf) if n_conf else None,
            n_conf,
            SOURCE,
            "mean agent-reported verdict confidence (self-reported, not calibrated); n = verdicts",
            reason=None if n_conf else "no verdicts with a confidence yet",
        ),
    }


def _citation_block(session: Session) -> tuple[CitationStatsOut, int, int]:
    transcripts = list(session.execute(select(DebateTranscript)).scalars().all())
    statuses = [check.status for _, check in load_investigation_citations(session, transcripts)]
    total = len(statuses)
    verified = statuses.count("VERIFIED")
    discrepancy = statuses.count("DISCREPANCY")
    invalid_row = statuses.count("INVALID_ROW")
    failing = total - verified
    citations = CitationStatsOut(
        verified_rate=_share(
            verified,
            total,
            "verified citations / total citations, exact match against raw_logs, all rounds",
            "no debate citations yet",
        ),
        invalid_rate=_share(
            failing,
            total,
            "citations that do not verify (DISCREPANCY or INVALID_ROW) / total citations",
            "no debate citations yet",
        ),
        total=_count(total, "cited evidence entries across all debate transcripts"),
        verified=_count(verified, "citations whose row exists and whose cited value matches it exactly"),
        discrepancy=_count(
            discrepancy, "citations whose row exists but whose cited field or value does not match"
        ),
        invalid_row=_count(invalid_row, "citations whose row_id is malformed or not in raw_logs"),
    )
    return citations, total, failing


def _mean_crs() -> Metric[float]:
    scores = [get_crs(agent_id) for agent_id in INVESTIGATOR_IDS]
    return make_metric(
        sum(scores) / len(scores),
        len(scores),
        SOURCE,
        "mean Watchdog credibility score (CrS) of the three investigator agents, read from Redis; "
        "n = investigators",
    )


def _chain_block(session: Session) -> ChainStatsOut:
    entries = list(session.execute(select(AuditTrail).order_by(AuditTrail.seq)).scalars().all())
    return ChainStatsOut(
        valid=find_first_break(entries) is None,
        entries=_count(len(entries), "audit_trail rows; the whole chain is verified on each call"),
        head_seq=make_metric(
            entries[-1].seq if entries else None,
            len(entries),
            SOURCE,
            "seq of the newest audit entry (chain head)",
            reason=None if entries else "no audit entries yet",
        ),
    )


def _watchdog_block(session: Session, citations_total: int, failing: int) -> WatchdogStatsOut:
    checks = session.execute(select(func.count()).select_from(CredibilityLog)).scalar_one()
    isolations = session.execute(
        select(func.count()).select_from(CredibilityLog).where(CredibilityLog.isolated.is_(True))
    ).scalar_one()
    return WatchdogStatsOut(
        checks_total=_count(
            checks, "Watchdog credibility checks (credibility_log rows, one per agent per round)"
        ),
        citations_checked=_count(citations_total, "cited evidence entries re-checked against raw_logs"),
        discrepancies=_count(failing, "re-checked citations that do not verify (DISCREPANCY or INVALID_ROW)"),
        isolations=_count(isolations, "credibility_log rows with isolated = true"),
    )


def _self_healing_block(session: Session) -> SelfHealingStatsOut:
    total = session.execute(select(func.count()).select_from(ResponseAction)).scalar_one()
    non_simulated = session.execute(
        select(func.count()).select_from(ResponseAction).where(ResponseAction.is_simulated.is_(False))
    ).scalar_one()
    return SelfHealingStatsOut(
        actions_total=_count(total, "response_actions rows (sandboxed containment actions)"),
        simulated_share=_share(
            total - non_simulated,
            total,
            "response actions with is_simulated = true / all response actions",
            "no response actions yet",
        ),
        non_simulated=_count(non_simulated, "response actions with is_simulated = false"),
    )


def _feedback_block(session: Session) -> tuple[FeedbackStatsOut, list[tuple[bool, float]]]:
    total = session.execute(select(func.count()).select_from(AnalystFeedback)).scalar_one()
    confirmed = session.execute(
        select(func.count()).select_from(AnalystFeedback).where(AnalystFeedback.verdict_was_correct.is_(True))
    ).scalar_one()
    scored = session.execute(
        select(AnalystFeedback.verdict_was_correct, Investigation.verdict_confidence)
        .join(Investigation, Investigation.investigation_id == AnalystFeedback.investigation_id)
        .where(Investigation.verdict_confidence.is_not(None))
    ).all()
    feedback = FeedbackStatsOut(
        total=_count(total, "analyst feedback rows (confirm or false positive)"),
        confirmed=_count(confirmed, "analyst feedback rows that confirmed the verdict"),
        false_positive=_count(
            total - confirmed, "analyst feedback rows that marked the verdict a false positive"
        ),
        agreement_rate=_share(
            confirmed, total, "analyst confirmations / analyst feedback rows", "no analyst feedback yet"
        ),
    )
    return feedback, [(bool(ok), float(conf)) for ok, conf in scored]


def _brier(scored: list[tuple[bool, float]]) -> Metric[float]:
    n = len(scored)
    value = sum((conf - (1.0 if ok else 0.0)) ** 2 for ok, conf in scored) / n if n else None
    return make_metric(
        value,
        n,
        SOURCE,
        "Brier score from analyst feedback only: mean of (agent-reported verdict confidence - outcome)^2, "
        "outcome 1 when the analyst confirmed the verdict, 0 when it was a false positive; "
        "n = feedback rows with a verdict confidence",
        reason=None if n else "no analyst feedback yet",
    )


def _latency_block(session: Session) -> LatencyStatsOut:
    def first_times(action: str) -> dict:
        return dict(
            session.execute(
                select(AuditTrail.investigation_id, func.min(AuditTrail.created_at))
                .where(AuditTrail.action == action, AuditTrail.investigation_id.is_not(None))
                .group_by(AuditTrail.investigation_id)
            ).all()
        )

    started = first_times("investigation_started")
    reached = first_times("verdict_reached")
    deltas = [(reached[i] - started[i]).total_seconds() for i in started if i in reached]
    n = len(deltas)
    return LatencyStatsOut(
        definition="audit investigation_started to verdict_reached, per investigation",
        mean_seconds=make_metric(
            sum(deltas) / n if n else None,
            n,
            SOURCE,
            "mean seconds from the investigation_started audit entry to the verdict_reached audit entry "
            "(audit created_at), per investigation; n = investigations with both",
            reason=None if n else "no investigation has both audit entries yet",
        ),
    )


@router.get("", response_model=StatsOut)
def get_stats(username: str = Depends(get_current_user)) -> StatsOut:
    session = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        investigations = _investigation_block(session, now)
        citations, citations_total, failing = _citation_block(session)
        feedback, scored_feedback = _feedback_block(session)
        return StatsOut(
            **investigations,
            mean_crs=_mean_crs(),
            citations=citations,
            chain=_chain_block(session),
            watchdog=_watchdog_block(session, citations_total, failing),
            self_healing=_self_healing_block(session),
            feedback=feedback,
            brier=_brier(scored_feedback),
            latency=_latency_block(session),
            generated_at=now,
        )
    finally:
        session.close()
