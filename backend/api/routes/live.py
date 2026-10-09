"""The simulated live feed (checklist RT1-RT6): status for every analyst, start and stop for a capability.

The feed replays dataset rows into RabbitMQ on its own and a monitor flags windows that look unusual.
This route only reports it and switches it on and off; the work is in backend/pipeline and
backend/api/live_runner.py.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from backend.api.auth import CurrentAnalyst, get_current_user, require_capability
from backend.api.live_runner import LIVE_CAP_SCOPE, LiveFeedError, runner
from backend.api.metrics import Metric, make_metric
from backend.api.rate_limit import GLOBAL_CAP_IDENTIFIER, client_ip, daily_runs, enforce_rate_limit
from backend.api.schemas.live import (
    LiveArrivalOut,
    LiveBlockedOut,
    LiveStartRequest,
    LiveStatusOut,
    LiveTriggerOut,
    LiveWindowOut,
)
from backend.config import settings
from backend.pipeline import live_state
from backend.pipeline.live_detector import FEATURE_NAME, GROUPS, WINDOW_SIZE

router = APIRouter(prefix="/live", tags=["live"])

SOURCE = "/live/status"
NOTICE = (
    "Simulated replay of dataset rows (CICIDS2017 flows and CERT r4.2 events) through RabbitMQ. "
    "No real network is monitored."
)
SOURCE_LABEL = {
    "network": "CICIDS2017 network flows",
    "logon": "CERT r4.2 logons",
    "device": "CERT r4.2 device events",
    "file": "CERT r4.2 file accesses",
}
NO_RATE_REASON = "needs two samples a second apart in the last 10 s (the feed is stopped or just started)"


def _count(value: int, definition: str) -> Metric[int]:
    return make_metric(value, value, SOURCE, definition)


def _window(group: str, saved: dict | None) -> LiveWindowOut:
    saved = saved or {}
    return LiveWindowOut(
        group=group,
        source=SOURCE_LABEL[group],
        feature=saved.get("feature", FEATURE_NAME[group]),
        size=saved.get("size", WINDOW_SIZE[group]),
        rows=saved.get("rows", 0),
        scored_rows=saved.get("scored_rows", 0),
        value=saved.get("value"),
        threshold=saved.get("threshold"),
        z=saved.get("z"),
        suspicion=saved.get("suspicion", 0.0),
        flagged=saved.get("flagged", False),
        rule=saved.get("rule", "the feed has not run yet"),
        evaluated_at=saved.get("evaluated_at"),
    )


def build_status() -> LiveStatusOut:
    counters = live_state.counters()
    config = live_state.config() or {}
    running = runner.running
    rate, samples = live_state.measured_rate()
    backlog = live_state.backlog()
    saved_windows = live_state.windows()
    trigger = live_state.last_trigger()
    blocked = live_state.blocked()
    return LiveStatusOut(
        state="running" if running else "stopped",
        simulated=True,
        notice=NOTICE,
        started_at=config.get("started_at"),
        started_by=config.get("started_by"),
        events_per_second=config.get("events_per_second"),
        auto_investigate=runner.auto_investigate if running else bool(config.get("auto_investigate", False)),
        published=_count(
            counters["published"], "rows the sensor has put on the queue since the feed was started"
        ),
        consumed=_count(
            counters["consumed"], "rows the monitor has taken off the queue and added to a window"
        ),
        rate=make_metric(
            rate,
            samples,
            SOURCE,
            "rows consumed per second over the last 10 s, from one sample per second",
            reason=None if rate is not None else NO_RATE_REASON,
        ),
        backlog=make_metric(
            backlog,
            1 if backlog is not None else 0,
            SOURCE,
            "messages waiting in the RabbitMQ queue, read by the sensor every 2 s",
            reason=None if backlog is not None else "the feed has not run yet",
        ),
        flagged=_count(counters["flagged"], "windows the rule flagged since the feed was started"),
        triggered=_count(
            counters["triggered"], "flagged windows that became an investigation since the feed was started"
        ),
        triggers_today=_count(
            daily_runs(LIVE_CAP_SCOPE, GLOBAL_CAP_IDENTIFIER),
            "automatic investigations accepted in the last 24 hours",
        ),
        daily_cap=make_metric(
            settings.live_daily_cap,
            1,
            "LIVE_DAILY_CAP",
            "automatic investigations allowed per 24 hours (setting)",
        ),
        windows=[_window(group, saved_windows.get(group)) for group in GROUPS],
        last_trigger=(
            LiveTriggerOut(
                investigation_id=trigger["investigation_id"],
                group=trigger["group"],
                reason=trigger["reason"],
                at=trigger["at"],
            )
            if trigger
            else None
        ),
        blocked=LiveBlockedOut(reason=blocked["reason"], at=blocked["at"]) if blocked else None,
        error=None if running else runner.thread_error(),
        generated_at=datetime.now(timezone.utc),
    )


@router.get("/status", response_model=LiveStatusOut)
def get_status(username: str = Depends(get_current_user)) -> LiveStatusOut:
    return build_status()


@router.get("/arrivals", response_model=list[LiveArrivalOut])
def get_arrivals(
    limit: int = Query(20, ge=1, le=100), username: str = Depends(get_current_user)
) -> list[LiveArrivalOut]:
    """The rows that arrived most recently, newest first (the last 100 are kept)."""
    return [LiveArrivalOut(**item) for item in live_state.arrivals(limit)]


@router.post("/start", response_model=LiveStatusOut)
def start_feed(
    request: Request,
    payload: LiveStartRequest | None = None,
    actor: CurrentAnalyst = Depends(require_capability("control_live_feed")),
) -> LiveStatusOut:
    enforce_rate_limit("live_control", client_ip(request), limit=10, window_seconds=60)
    options = payload or LiveStartRequest()
    try:
        runner.start(actor.username, options.events_per_second, options.auto_investigate)
    except LiveFeedError as exc:
        raise HTTPException(exc.status_code, detail=str(exc)) from exc
    return build_status()


@router.post("/stop", response_model=LiveStatusOut)
def stop_feed(
    request: Request, actor: CurrentAnalyst = Depends(require_capability("control_live_feed"))
) -> LiveStatusOut:
    enforce_rate_limit("live_control", client_ip(request), limit=10, window_seconds=60)
    try:
        runner.stop(actor.username)
    except LiveFeedError as exc:
        raise HTTPException(exc.status_code, detail=str(exc)) from exc
    return build_status()
