"""Request and response models for analyst feedback, citations, the evidence bundle and sign-off."""

from typing import Any, Literal

from pydantic import BaseModel

from backend.api.metrics import Metric


class FeedbackRequest(BaseModel):
    verdict_was_correct: bool


CitationStatus = Literal["VERIFIED", "DISCREPANCY", "INVALID_ROW"]
CitationReason = Literal["ok", "row_not_found", "malformed_row_id", "field_not_found", "value_mismatch"]


class CitationItemOut(BaseModel):
    row_id: str
    field: str
    value: str
    expected: str | None
    status: CitationStatus
    reason: CitationReason
    agent_id: str
    round: int
    row_fingerprint: str | None


class GlobalCitationOut(CitationItemOut):
    investigation_id: str


class CitationSummaryOut(BaseModel):
    total: int
    verified: int
    discrepancy: int
    invalid_row: int
    match_rate: Metric[float]


class InvestigationCitationsOut(BaseModel):
    investigation_id: str
    summary: CitationSummaryOut
    citations: list[CitationItemOut]


class SignatureOut(BaseModel):
    signed_by: str
    signed_at: str
    bundle_sha256: str
    still_matches: bool


class EvidenceBundleOut(BaseModel):
    bundle: dict[str, Any]
    bundle_sha256: str
    signatures: list[SignatureOut]


class SignOut(BaseModel):
    signed_by: str
    signed_at: str
    bundle_sha256: str
    audit_seq: int
    entry_hash: str
    notice: str
