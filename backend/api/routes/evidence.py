"""Evidence routes (plan section 3.4): citations, the evidence bundle and sign-off.

Citations are re-checked against raw_logs on every read, so a citation's status always reflects the
raw rows as they are now. The evidence bundle is hashed over a canonical JSON form. Sign-off appends
an audited acknowledgement. It is not a cryptographic signature.
"""

import hashlib
import json
import uuid
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.agents.schemas import CitedEvidence
from backend.api.auth import CurrentAnalyst, get_current_analyst, get_current_user
from backend.api.metrics import make_metric
from backend.api.rate_limit import read_limit
from backend.api.rbac import role_has
from backend.api.schemas.evidence import (
    CitationItemOut,
    CitationStatus,
    CitationSummaryOut,
    EvidenceBundleOut,
    GlobalCitationOut,
    InvestigationCitationsOut,
    SignatureOut,
    SignOut,
)
from backend.db.audit import append_entry
from backend.db.models import (
    AuditTrail,
    CredibilityLog,
    DebateTranscript,
    Investigation,
    ResponseAction,
)
from backend.db.session import SessionLocal
from backend.watchdog.verification import CitationCheck, check_citations

router = APIRouter(tags=["evidence"])

SIGNABLE_STATUSES = frozenset({"verdict_reached", "contained", "ambiguous"})
SIGN_NOTICE = (
    "Audited acknowledgement in the hash-chained audit trail. This is not a cryptographic digital signature."
)
SIGN_ACTION = "evidence_bundle_signed"


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def require_capability(capability: str) -> Callable[..., CurrentAnalyst]:
    """Dependency: the role comes from the database on this request (get_current_analyst), and must hold
    `capability` in backend/api/rbac.py. Deny by default.
    """

    def dependency(analyst: CurrentAnalyst = Depends(get_current_analyst)) -> CurrentAnalyst:
        if not role_has(analyst.role, capability):
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail=f"Missing capability: {capability}")
        return analyst

    return dependency


def load_investigation_citations(
    session: Session, transcripts: list[DebateTranscript]
) -> list[tuple[DebateTranscript, CitationCheck]]:
    """Checks every cited entry of the given transcript rows with one IN-query. Input order is kept."""
    owners: list[DebateTranscript] = []
    entries: list[CitedEvidence] = []
    for transcript in transcripts:
        for raw in transcript.cited_evidence or []:
            owners.append(transcript)
            entries.append(
                CitedEvidence(
                    row_id=str(raw.get("row_id", "")),
                    field=str(raw.get("field", "")),
                    value=str(raw.get("value", "")),
                )
            )
    return list(zip(owners, check_citations(session, entries), strict=True))


def citation_item(transcript: DebateTranscript, check: CitationCheck) -> CitationItemOut:
    return CitationItemOut(
        row_id=check.row_id,
        field=check.field,
        value=check.value,
        expected=check.expected,
        status=check.status,
        reason=check.reason,
        agent_id=transcript.agent_id,
        round=transcript.round,
        row_fingerprint=check.row_fingerprint,
    )


def citation_summary(statuses: list[CitationStatus], source: str) -> CitationSummaryOut:
    total = len(statuses)
    verified = statuses.count("VERIFIED")
    discrepancy = statuses.count("DISCREPANCY")
    invalid_row = statuses.count("INVALID_ROW")
    return CitationSummaryOut(
        total=total,
        verified=verified,
        discrepancy=discrepancy,
        invalid_row=invalid_row,
        match_rate=make_metric(
            verified / total if total else None,
            total,
            source=source,
            definition=(
                "verified citations / total citations: the cited value is the stored value as the agents "
                "read it (JSON text) or the same number, checked against raw_logs"
            ),
            reason=None if total else "no citations yet",
        ),
    )


def investigation_transcripts(session: Session, investigation_id: uuid.UUID) -> list[DebateTranscript]:
    return list(
        session.execute(
            select(DebateTranscript)
            .where(DebateTranscript.investigation_id == investigation_id)
            .order_by(DebateTranscript.round, DebateTranscript.agent_id, DebateTranscript.created_at)
        )
        .scalars()
        .all()
    )


def build_bundle(session: Session, investigation: Investigation) -> dict[str, Any]:
    """The evidence bundle as a plain dict. Deterministic for a given investigation: every row is final
    once the verdict is reached, and raw_logs is append-only. Labels are never selected.
    """
    investigation_id = investigation.investigation_id
    transcripts = investigation_transcripts(session, investigation_id)
    credibility = (
        session.execute(
            select(CredibilityLog)
            .where(CredibilityLog.investigation_id == investigation_id)
            .order_by(
                CredibilityLog.created_at, CredibilityLog.round, CredibilityLog.agent_id, CredibilityLog.id
            )
        )
        .scalars()
        .all()
    )
    actions = (
        session.execute(
            select(ResponseAction)
            .where(ResponseAction.investigation_id == investigation_id)
            .order_by(ResponseAction.created_at, ResponseAction.id)
        )
        .scalars()
        .all()
    )
    checked = load_investigation_citations(session, transcripts)
    items = [citation_item(t, c) for t, c in checked]
    summary = citation_summary([c.status for _, c in checked], source="/investigations/evidence-bundle")

    bundle = {
        "investigation_id": str(investigation_id),
        "verdict": {
            "verdict_class": investigation.verdict_class,
            "verdict_confidence": investigation.verdict_confidence,
            "status": investigation.status,
        },
        "transcript": [
            {
                "round": t.round,
                "agent_id": t.agent_id,
                "theory": t.theory,
                "confidence": t.confidence,
                "provider": t.provider,
                "cited_evidence": t.cited_evidence,
                "created_at": _iso(t.created_at),
            }
            for t in transcripts
        ],
        "credibility": [
            {
                "round": c.round,
                "agent_id": c.agent_id,
                "crs_before": c.crs_before,
                "crs_after": c.crs_after,
                "verification_match_rate": c.verification_match_rate,
                "isolated": c.isolated,
                "created_at": _iso(c.created_at),
            }
            for c in credibility
        ],
        "actions": [
            {
                "action_type": a.action_type,
                "target": a.target,
                "reason": a.reason,
                "is_simulated": a.is_simulated,
                "created_at": _iso(a.created_at),
            }
            for a in actions
        ],
        "citations": {
            "total": summary.total,
            "verified": summary.verified,
            "discrepancy": summary.discrepancy,
            "invalid_row": summary.invalid_row,
            "items": [item.model_dump() for item in items],
        },
    }
    return canonical_numbers(bundle)


def canonical_numbers(value: Any) -> Any:
    """Numbers as JavaScript writes them: an integral float becomes an int (1.0 -> 1, as JSON.stringify
    does), other floats are rounded to 6 decimal places. Booleans are left alone.
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, float):
        return int(value) if value.is_integer() else round(value, 6)
    if isinstance(value, dict):
        return {key: canonical_numbers(item) for key, item in value.items()}
    if isinstance(value, list):
        return [canonical_numbers(item) for item in value]
    return value


def canonical_bytes(bundle: dict[str, Any]) -> bytes:
    """Sorted keys, compact separators, UTF-8, canonical numbers. The browser recomputes the same SHA-256."""
    return json.dumps(
        canonical_numbers(bundle), sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    ).encode("utf-8")


def bundle_sha256(bundle: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_bytes(bundle)).hexdigest()


def _signatures(session: Session, investigation_id: uuid.UUID, current_digest: str) -> list[SignatureOut]:
    entries = (
        session.execute(
            select(AuditTrail)
            .where(AuditTrail.investigation_id == investigation_id, AuditTrail.action == SIGN_ACTION)
            .order_by(AuditTrail.seq)
        )
        .scalars()
        .all()
    )
    signatures = []
    for entry in entries:
        detail = entry.detail or {}
        digest = str(detail.get("bundle_sha256", ""))
        signatures.append(
            SignatureOut(
                signed_by=entry.actor,
                signed_at=str(detail.get("signed_at", _iso(entry.created_at))),
                bundle_sha256=digest,
                still_matches=digest == current_digest,
            )
        )
    return signatures


@router.get(
    "/investigations/{investigation_id}/citations",
    response_model=InvestigationCitationsOut,
    dependencies=[read_limit("citations", 120)],
)
def investigation_citations(
    investigation_id: uuid.UUID, username: str = Depends(get_current_user)
) -> InvestigationCitationsOut:
    session = SessionLocal()
    try:
        if session.get(Investigation, investigation_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Investigation not found")
        checked = load_investigation_citations(session, investigation_transcripts(session, investigation_id))
        return InvestigationCitationsOut(
            investigation_id=str(investigation_id),
            summary=citation_summary(
                [c.status for _, c in checked], source=f"/investigations/{investigation_id}/citations"
            ),
            citations=[citation_item(t, c) for t, c in checked],
        )
    finally:
        session.close()


@router.get("/citations", response_model=list[GlobalCitationOut], dependencies=[read_limit("citations", 120)])
def list_citations(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    agent_id: str | None = None,
    status_filter: CitationStatus | None = Query(None, alias="status"),
    username: str = Depends(get_current_user),
) -> list[GlobalCitationOut]:
    """Newest investigations first. The status filter needs every check, so the page is cut in Python."""
    session = SessionLocal()
    try:
        query = select(DebateTranscript).order_by(DebateTranscript.created_at.desc(), DebateTranscript.id)
        if agent_id is not None:
            query = query.where(DebateTranscript.agent_id == agent_id)
        transcripts = session.execute(query).scalars().all()
        checked = load_investigation_citations(session, list(transcripts))
        filtered = [(t, c) for t, c in checked if status_filter is None or c.status == status_filter]
        page = filtered[offset : offset + limit]
        return [
            GlobalCitationOut(**citation_item(t, c).model_dump(), investigation_id=str(t.investigation_id))
            for t, c in page
        ]
    finally:
        session.close()


@router.get("/investigations/{investigation_id}/evidence-bundle", response_model=EvidenceBundleOut)
def evidence_bundle(
    investigation_id: uuid.UUID, username: str = Depends(get_current_user)
) -> EvidenceBundleOut:
    session = SessionLocal()
    try:
        investigation = session.get(Investigation, investigation_id)
        if investigation is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Investigation not found")
        bundle = build_bundle(session, investigation)
        digest = bundle_sha256(bundle)
        return EvidenceBundleOut(
            bundle=bundle,
            bundle_sha256=digest,
            signatures=_signatures(session, investigation_id, digest),
        )
    finally:
        session.close()


@router.post(
    "/investigations/{investigation_id}/sign",
    status_code=status.HTTP_201_CREATED,
    response_model=SignOut,
)
def sign_evidence_bundle(
    investigation_id: uuid.UUID,
    analyst: CurrentAnalyst = Depends(require_capability("sign_evidence_bundle")),
) -> SignOut:
    username = analyst.username
    session = SessionLocal()
    try:
        investigation = session.get(Investigation, investigation_id)
        if investigation is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Investigation not found")
        if investigation.status not in SIGNABLE_STATUSES:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail=f"Investigation status is {investigation.status!r}; only verdict_reached, contained "
                "or ambiguous can be signed",
            )

        digest = bundle_sha256(build_bundle(session, investigation))
        signed_at = datetime.now(timezone.utc).isoformat()
        entry = append_entry(
            session,
            actor=username,
            action=SIGN_ACTION,
            detail={"bundle_sha256": digest, "signed_at": signed_at},
            investigation_id=investigation_id,
        )
        session.commit()
        return SignOut(
            signed_by=username,
            signed_at=signed_at,
            bundle_sha256=digest,
            audit_seq=entry.seq,
            entry_hash=entry.entry_hash,
            notice=SIGN_NOTICE,
        )
    finally:
        session.close()
