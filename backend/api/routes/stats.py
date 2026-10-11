"""Headline metrics (plan sections 2 and 3.4): every KPI is a Metric envelope with its n and definition.

Empty database: every rate and average is null with a reason, and every count is a real 0 (plan R2).
Citations are re-checked against raw_logs and the audit chain is verified when the response is computed
(the chain incrementally from its last verified checkpoint, see backend/api/audit_chain.py). A computed
response is cached in Redis for STATS_CACHE_TTL_SECONDS and dropped by every committed transaction
(backend/db/change_events.py), so a finished debate is never hidden behind it. A cache failure only means
the response is computed.
"""

import logging
import statistics
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.agents.registry import INVESTIGATOR_IDS
from backend.api.audit_chain import ChainCheck, verify_audit_chain
from backend.api.auth import get_current_user
from backend.api.metrics import Metric, make_metric
from backend.api.routes.evidence import load_investigation_citations
from backend.api.schemas.stats import (
    AutomationStatsOut,
    ChainStatsOut,
    CitationStatsOut,
    FeedbackStatsOut,
    LatencyStatsOut,
    SelfHealingStatsOut,
    StatsOut,
    WatchdogStatsOut,
)
from backend.db.change_events import load_stats_cache, stats_cache_generation, store_stats_cache
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

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/stats", tags=["stats"])

SOURCE = "/stats"
STATS_CACHE_TTL_SECONDS = 5
ACTIVE_WINDOW = timedelta(minutes=30)
THREAT_WINDOW = timedelta(hours=24)
AUTOMATION_WINDOW = timedelta(hours=24)
# Audit actions an analyst performs on a case's containment; a case that has one was not contained hands-free.
ANALYST_CONTAINMENT_ACTIONS = ("emergency_containment", "containment_released")
THREAT_STATUSES = ("verdict_reached", "contained")
VERDICT_STATUSES = ("verdict_reached", "contained", "ambiguous")
KNOWN_STATUSES = ("queued", "investigating", "verdict_reached", "contained", "ambiguous", "error")


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
            "verified citations / total citations against raw_logs (the value as the agents read it, "
            "or the same number), all rounds",
            "no debate citations yet",
        ),
        invalid_rate=_share(
            failing,
            total,
            "citations that do not verify (DISCREPANCY or INVALID_ROW) / total citations",
            "no debate citations yet",
        ),
        total=_count(total, "cited evidence entries across all debate transcripts"),
        verified=_count(
            verified,
            "citations whose row exists and whose cited value is the stored value (or the same number)",
        ),
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


def _chain_coverage(check: ChainCheck) -> str:
    """What this computation verified, stated as it ran (plan R1): the Proof popover shows this text."""
    if check.mode == "full":
        scope = (
            "the whole chain was walked: every entry hash and link was recomputed"
            if check.entries_checked
            else "the chain is empty, so there was nothing to walk"
        )
    else:
        scope = (
            "the chain was verified incrementally: the last verified checkpoint "
            f"(seq {check.verified_from_seq}) was re-checked and {check.entries_checked} entries, that "
            "one included, were recomputed, so entries before that seq were not re-walked here; "
            "POST /audit-trail/verify?full=true re-walks all of them"
        )
    outcome = (
        "no break found" if check.valid else f"break found at seq {check.first_break_seq} ({check.reason})"
    )
    return f"When computed, {scope}; {outcome}."


def _chain_block(session: Session) -> ChainStatsOut:
    check = verify_audit_chain(session)
    total = session.execute(select(func.count()).select_from(AuditTrail)).scalar_one()
    return ChainStatsOut(
        valid=check.valid,
        entries=_count(total, f"audit_trail rows. {_chain_coverage(check)}"),
        head_seq=make_metric(
            check.head_seq,
            total,
            SOURCE,
            "seq of the newest audit entry (chain head)",
            reason=None if total else "no audit entries yet",
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


def _automation_block(session: Session, now: datetime) -> AutomationStatsOut:
    """What the live monitor started and finished by itself in the last 24 hours, and how long it took."""
    in_window = Investigation.created_at >= now - AUTOMATION_WINDOW
    automatic = Investigation.trigger_type == "continuous"
    cases = _investigation_count(session, in_window)
    auto_started = _investigation_count(session, in_window, automatic)
    analyst_touched = select(AuditTrail.investigation_id).where(
        AuditTrail.action.in_(ANALYST_CONTAINMENT_ACTIONS), AuditTrail.investigation_id.is_not(None)
    )
    hands_free = _investigation_count(
        session,
        in_window,
        automatic,
        Investigation.status == "contained",
        Investigation.investigation_id.not_in(analyst_touched),
    )

    def first_audit_time(action: str) -> dict:
        return dict(
            session.execute(
                select(AuditTrail.investigation_id, func.min(AuditTrail.created_at))
                .join(Investigation, Investigation.investigation_id == AuditTrail.investigation_id)
                .where(AuditTrail.action == action, in_window)
                .group_by(AuditTrail.investigation_id)
            ).all()
        )

    started = first_audit_time("investigation_started")
    reached = first_audit_time("verdict_reached")
    first_action = dict(
        session.execute(
            select(ResponseAction.investigation_id, func.min(ResponseAction.created_at))
            .join(Investigation, Investigation.investigation_id == ResponseAction.investigation_id)
            .where(in_window)
            .group_by(ResponseAction.investigation_id)
        ).all()
    )
    to_verdict = [(reached[i] - started[i]).total_seconds() for i in started if i in reached]
    to_action = [(first_action[i] - reached[i]).total_seconds() for i in reached if i in first_action]
    return AutomationStatsOut(
        cases=_count(cases, "investigations accepted in the last 24 hours, whoever started them"),
        auto_started=_count(
            auto_started, "of those, investigations started by the live monitor (trigger_type = continuous)"
        ),
        auto_share=_share(
            auto_started,
            cases,
            "investigations started by the live monitor / all investigations accepted, last 24 hours",
            "no investigation was accepted in the last 24 hours",
        ),
        hands_free_contained=_count(
            hands_free,
            "investigations the live monitor started that ended contained with no analyst emergency "
            "containment or release on them: detection, debate, verdict and containment without a click",
        ),
        median_seconds_to_verdict=make_metric(
            statistics.median(to_verdict) if to_verdict else None,
            len(to_verdict),
            SOURCE,
            "median seconds from the investigation_started audit entry to the verdict_reached audit entry, "
            "last 24 hours (includes any wait in the debate queue); n = investigations with both",
            reason=None if to_verdict else "no investigation reached a verdict in the last 24 hours",
        ),
        median_seconds_verdict_to_action=make_metric(
            statistics.median(to_action) if to_action else None,
            len(to_action),
            SOURCE,
            "median seconds from the verdict_reached audit entry to the first sandboxed response action, "
            "last 24 hours; n = investigations that have both",
            reason=None if to_action else "no investigation was contained in the last 24 hours",
        ),
    )


def _compute_stats() -> StatsOut:
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
            automation=_automation_block(session, now),
            generated_at=now,
        )
    finally:
        session.close()


def _cached_stats() -> StatsOut | None:
    try:
        payload = load_stats_cache()
        return StatsOut.model_validate_json(payload) if payload else None
    except Exception as exc:  # noqa: BLE001 - the cache is an optimisation; compute instead
        logger.warning("stats cache unreadable (%s); computing", type(exc).__name__)
        return None


def _generation() -> str | None:
    try:
        return stats_cache_generation()
    except Exception as exc:  # noqa: BLE001
        logger.warning("stats cache unavailable (%s); not caching this response", type(exc).__name__)
        return None


def _store_stats(generation: str | None, stats: StatsOut) -> None:
    if generation is None:
        return
    try:
        store_stats_cache(generation, stats.model_dump_json(), STATS_CACHE_TTL_SECONDS)
    except Exception as exc:  # noqa: BLE001
        logger.warning("could not cache the stats response (%s)", type(exc).__name__)


@router.get("", response_model=StatsOut)
def get_stats(username: str = Depends(get_current_user)) -> StatsOut:
    cached = _cached_stats()
    if cached is not None:
        return cached
    generation = _generation()  # read before computing: a commit during the computation voids the store
    stats = _compute_stats()
    _store_stats(generation, stats)
    return stats
