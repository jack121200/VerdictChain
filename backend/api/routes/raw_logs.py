"""Raw-log read routes (plan section 3.4): allow-listed rows, recent rows and per-source counts.

Responses never include ground_truth_label. raw_fields is sanitised before it leaves the server: JSON-safe,
NaN and infinity dropped, strings cut to 2000 characters, control characters removed, nesting capped.
Static paths are declared before /{row_id} so that "recent" and "counts" are not parsed as UUIDs.
"""

import math
import unicodedata
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select

from backend.api.auth import get_current_user
from backend.api.metrics import make_metric
from backend.api.schemas.read import RawLogCountOut, RawLogCountsOut, RawLogOut
from backend.db.models import RawLog
from backend.db.session import SessionLocal

router = APIRouter(prefix="/raw-logs", tags=["raw-logs"])

KNOWN_SOURCES: tuple[str, ...] = ("cicids2017", "cert_r4.2_logon", "cert_r4.2_file", "cert_r4.2_device")
MAX_STRING_LENGTH = 2000
MAX_DEPTH = 6
_DROP = object()


def _clean_text(text: str) -> str:
    without_controls = "".join(ch for ch in text if unicodedata.category(ch) != "Cc")
    return without_controls[:MAX_STRING_LENGTH]


def _sanitize(value: Any, depth: int) -> Any:
    if value is None or isinstance(value, bool | int):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else _DROP
    if isinstance(value, str):
        return _clean_text(value)
    if depth >= MAX_DEPTH or not isinstance(value, dict | list):
        return _DROP
    if isinstance(value, dict):
        cleaned: dict[str, Any] = {}
        for key, item in value.items():
            safe = _sanitize(item, depth + 1)
            if safe is not _DROP:
                cleaned[_clean_text(str(key))] = safe
        return cleaned
    items = (_sanitize(item, depth + 1) for item in value)
    return [item for item in items if item is not _DROP]


def sanitize_raw_fields(raw_fields: Any) -> dict[str, Any]:
    safe = _sanitize(raw_fields, 0)
    return safe if isinstance(safe, dict) else {}


def _out(row: RawLog) -> RawLogOut:
    return RawLogOut(
        row_id=str(row.row_id),
        timestamp=row.timestamp,
        source=row.source,
        source_file=row.source_file,
        event_type=row.event_type,
        user_id=row.user_id,
        host_id=row.host_id,
        severity=row.severity,
        raw_fields=sanitize_raw_fields(row.raw_fields),
    )


@router.get("/recent", response_model=list[RawLogOut])
def recent_raw_logs(
    limit: int = Query(50, ge=1, le=200),
    source: str | None = Query(None, max_length=64),
    username: str = Depends(get_current_user),
) -> list[RawLogOut]:
    session = SessionLocal()
    try:
        query = select(RawLog)
        if source:
            query = query.where(RawLog.source == source)
        rows = session.execute(query.order_by(RawLog.timestamp.desc(), RawLog.row_id).limit(limit)).scalars()
        return [_out(row) for row in rows]
    finally:
        session.close()


@router.get("/counts", response_model=RawLogCountsOut)
def raw_log_counts(username: str = Depends(get_current_user)) -> RawLogCountsOut:
    session = SessionLocal()
    try:
        by_source = dict(session.execute(select(RawLog.source, func.count()).group_by(RawLog.source)).all())
        sources = list(KNOWN_SOURCES) + sorted(s for s in by_source if s not in KNOWN_SOURCES)
        total = sum(by_source.values())
        return RawLogCountsOut(
            total=make_metric(total, total, "/raw-logs/counts", "rows in raw_logs, all sources"),
            sources=[
                RawLogCountOut(
                    source=source,
                    count=make_metric(
                        by_source.get(source, 0),
                        by_source.get(source, 0),
                        "/raw-logs/counts",
                        f"rows in raw_logs with source = {source}",
                    ),
                )
                for source in sources
            ],
        )
    finally:
        session.close()


@router.get("/{row_id}", response_model=RawLogOut)
def get_raw_log(row_id: uuid.UUID, username: str = Depends(get_current_user)) -> RawLogOut:
    session = SessionLocal()
    try:
        row = session.get(RawLog, row_id)
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Raw log row not found")
        return _out(row)
    finally:
        session.close()
