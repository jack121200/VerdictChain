"""Runs the simulated live feed and turns a flagged window into an investigation (checklist RT3, RT4, RT6).

start() runs the sensor (backend/pipeline/live_feed.py) and the monitor (live_monitor.py) as two threads
of this process, connected by a RabbitMQ queue. When the monitor flags a window, on_flag() decides whether an
investigation starts and puts it into the debate queue (backend/api/debate_queue.py), where the worker
threads run it like any other, as many side by side as there are debate slots. Nobody clicks anything.

Every source group (network, logon, device, file) has its own window, so each can start its own investigation
as soon as its rows look unusual, and a flagged window never waits for an unrelated one to finish.

What keeps the feed from running away with the model quota: a minimum gap between two automatic
investigations from the same source window, a limit on how many wait for a free slot at once, a daily cap of
their own that also counts in the global debate cap, and the same intake pause and queue limits as a manual
request. When one of these says no, the reason is kept and shown on the Live page.

The model behind every debate is OpenAI. The live feed adds a gate of its own (owner's decision): no flagged
window may open an investigation until the feed has streamed `llm_after_rows` rows (chosen when the feed is
started), OpenAI is configured and the token budget has room, so nothing is spent while the feed warms up.

The investigators get rows only. The evaluation label of the window (backend/evaluation/live_labels.py) is
written to the investigation row on the server and is not part of anything the debate reads.
"""

import logging
import math
import threading
import time
from datetime import datetime, timezone

import pika
import redis
from sqlalchemy import func, select

from backend.agents import openai_usage
from backend.api.debate_queue import (
    active_agent_count,
    build_run_spec,
    intake_paused,
    queue_length,
    worker,
)
from backend.api.rate_limit import GLOBAL_CAP_IDENTIFIER, daily_runs, record_daily_run
from backend.config import settings
from backend.db.audit import append_entry
from backend.db.models import Investigation, RawLog
from backend.db.session import SessionLocal
from backend.debate.engine import (
    ESTIMATED_TOKENS_PER_DEBATE,
    MIN_ACTIVE_AGENTS,
    REQUESTS_PER_DEBATE,
    start_investigation,
)
from backend.debate.state import dominant_agent_for_rows
from backend.evaluation.live_labels import evaluation_label
from backend.pipeline import live_state
from backend.pipeline.live_detector import rank_rows
from backend.pipeline.live_feed import LiveFeed, load_pools
from backend.pipeline.live_monitor import Flag, LiveMonitor, compute_baselines

logger = logging.getLogger(__name__)

LIVE_ACTOR = "live_monitor"
LIVE_CAP_SCOPE = "live_auto"
MAX_ROWS_PER_AGENT = 5
BACKOFF_AFTER_FAILURE = 5  # times the minimum gap, after an automatic investigation ended in error
MIN_EVENTS_PER_SECOND = 0.5
MAX_EVENTS_PER_SECOND = 50.0
MIN_LLM_AFTER_ROWS = 50
MAX_LLM_AFTER_ROWS = 20000


class LiveFeedError(Exception):
    """The feed could not be started. `status_code` is the HTTP status the route answers with."""

    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.status_code = status_code


class LiveRunner:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._feed: LiveFeed | None = None
        self._monitor: LiveMonitor | None = None
        self._auto = True
        self._queue_name = settings.live_feed_queue
        self.last_error: str | None = None

    # ---- state ---------------------------------------------------------------

    @property
    def running(self) -> bool:
        return (
            self._feed is not None and self._monitor is not None and self._feed.alive and self._monitor.alive
        )

    @property
    def auto_investigate(self) -> bool:
        return self._auto

    def thread_error(self) -> str | None:
        """Why a thread ended by itself, if it did."""
        for part in (self._feed, self._monitor):
            if part is not None and part.error:
                return part.error
        return self.last_error

    # ---- start and stop --------------------------------------------------------

    def start(
        self,
        actor: str,
        events_per_second: float | None = None,
        auto_investigate: bool | None = None,
        llm_after_rows: int | None = None,
    ) -> None:
        rate = settings.live_feed_events_per_second if events_per_second is None else events_per_second
        if not MIN_EVENTS_PER_SECOND <= rate <= MAX_EVENTS_PER_SECOND:
            raise LiveFeedError(
                f"events_per_second must be between {MIN_EVENTS_PER_SECOND:g} and {MAX_EVENTS_PER_SECOND:g}",
                422,
            )
        activation = settings.live_llm_after_rows if llm_after_rows is None else llm_after_rows
        if not MIN_LLM_AFTER_ROWS <= activation <= MAX_LLM_AFTER_ROWS:
            raise LiveFeedError(
                f"llm_after_rows must be between {MIN_LLM_AFTER_ROWS:,} and {MAX_LLM_AFTER_ROWS:,}", 422
            )
        with self._lock:
            if self.running:
                raise LiveFeedError("The live feed is already running.", 409)
            self._stop_threads()
            self._queue_name = settings.live_feed_queue
            self._prepare_queue()
            pools = load_pools()
            if not pools.attack and not any(pools.benign.values()):
                raise LiveFeedError("No dataset rows are ingested, so there is nothing to replay.", 409)
            self._auto = settings.live_auto_investigate if auto_investigate is None else auto_investigate
            live_state.reset()
            live_state.set_config(
                {
                    "started_at": datetime.now(timezone.utc).isoformat(),
                    "started_by": actor,
                    "events_per_second": rate,
                    "auto_investigate": self._auto,
                    "llm_after_rows": activation,
                }
            )
            self.last_error = None
            self._monitor = LiveMonitor(
                queue_name=self._queue_name, baselines=compute_baselines(), on_flag=self.on_flag
            )
            self._feed = LiveFeed(
                queue_name=self._queue_name,
                events_per_second=rate,
                attack_share=settings.live_feed_attack_share,
                pools=pools,
            )
            self._monitor.start()
            self._feed.start()
            worker.ensure_started()
            self._audit(
                actor,
                "live_feed_started",
                {
                    "events_per_second": rate,
                    "attack_share": settings.live_feed_attack_share,
                    "auto_investigate": self._auto,
                    "llm_after_rows": activation,
                    "queue": self._queue_name,
                },
            )

    def stop(self, actor: str) -> None:
        with self._lock:
            if not self.running and self._feed is None:
                raise LiveFeedError("The live feed is not running.", 409)
            self._stop_threads()
            self._audit(actor, "live_feed_stopped", live_state.counters())

    def shutdown(self) -> None:
        """Stops the threads when the API stops. Not audited: the process is ending, nobody asked."""
        with self._lock:
            self._stop_threads()

    def _stop_threads(self) -> None:
        for part in (self._feed, self._monitor):
            if part is not None:
                self.last_error = part.error or self.last_error
                part.stop()
        self._feed = None
        self._monitor = None

    def _prepare_queue(self) -> None:
        """Checks that RabbitMQ answers and empties the queue, so a new run starts with no old messages."""
        try:
            connection = pika.BlockingConnection(pika.URLParameters(settings.rabbitmq_url))
        except Exception as exc:  # noqa: BLE001 - any connection failure means the broker is not available
            raise LiveFeedError(
                f"RabbitMQ is not reachable ({type(exc).__name__}). Start it with docker compose.", 503
            ) from exc
        try:
            channel = connection.channel()
            channel.queue_declare(queue=self._queue_name, durable=False)
            channel.queue_purge(self._queue_name)
        finally:
            connection.close()

    @staticmethod
    def _audit(actor: str, action: str, detail: dict) -> None:
        with SessionLocal() as session:
            append_entry(session, actor=actor, action=action, detail=detail)
            session.commit()

    # ---- the trigger -------------------------------------------------------------

    def on_flag(self, flag: Flag) -> bool:
        """Called by the monitor from its own thread. True when an investigation was accepted."""
        if not self._auto:
            return False
        reason = self._blocked_reason(flag.group)
        if reason is not None:
            live_state.set_blocked(reason, datetime.now(timezone.utc).isoformat())
            return False
        investigation_id = self._open_investigation(flag)
        if investigation_id is None:
            return False
        record_daily_run(LIVE_CAP_SCOPE, GLOBAL_CAP_IDENTIFIER)
        record_daily_run("debate_global", GLOBAL_CAP_IDENTIFIER)
        live_state.incr("triggered")
        live_state.set_blocked(None)
        accepted_at = time.time()
        live_state.set_group_trigger(flag.group, accepted_at)
        live_state.set_trigger(
            {
                "investigation_id": str(investigation_id),
                "group": flag.group,
                "reason": flag.score.rule,
                "at": datetime.now(timezone.utc).isoformat(),
                "at_epoch": accepted_at,
            }
        )
        worker.ensure_started()
        worker.notify()
        return True

    @staticmethod
    def _llm_blocked_reason() -> str | None:
        """Why OpenAI may not be asked yet: it is not set up, the feed has not streamed enough rows (the
        monitor scores windows from row 1, but no model call is made before then), or the token budget is
        used up. This is the gate that keeps the first OpenAI call back."""
        if not openai_usage.configured():
            return "OpenAI is not configured (OPENAI_API_KEY is empty), so no automatic investigation can run"
        needed = int((live_state.config() or {}).get("llm_after_rows", settings.live_llm_after_rows))
        seen = live_state.counters()["consumed"]
        if seen < needed:
            return f"warming up: {seen:,} of {needed:,} rows seen; OpenAI is not called before that"
        try:
            used = openai_usage.usage_24h().tokens
        except redis.RedisError:
            return "the OpenAI token budget cannot be checked (Redis is not reachable)"
        limit = openai_usage.token_limit()
        if used >= limit:
            return f"the OpenAI token budget for 24 hours is used up ({used:,} of {limit:,} tokens)"
        allowance = openai_usage.allowance_block(
            needed_requests=REQUESTS_PER_DEBATE, needed_tokens=ESTIMATED_TOKENS_PER_DEBATE
        )
        if allowance is not None:
            return allowance.rstrip(".")
        return None

    @classmethod
    def _blocked_reason(cls, group: str | None = None) -> str | None:
        """Why a flagged window of `group` may not open an investigation right now, None when it may."""
        llm = cls._llm_blocked_reason()
        if llm is not None:
            return llm
        if intake_paused():
            return "intake is paused"
        if active_agent_count() < MIN_ACTIVE_AGENTS:
            return f"fewer than {MIN_ACTIVE_AGENTS} investigators are active"
        last = live_state.group_trigger_at(group) if group is not None else None
        if last is not None:
            remaining = settings.live_min_gap_seconds - (time.time() - last)
            if remaining > 0:
                return (
                    f"cooling down: {math.ceil(remaining)} s until the next automatic investigation "
                    f"from the {group} window"
                )
        with SessionLocal() as session:
            latest = session.execute(
                select(Investigation.status, Investigation.created_at)
                .where(Investigation.trigger_type == "continuous")
                .order_by(Investigation.created_at.desc())
                .limit(1)
            ).first()
            if latest is not None and latest.status == "error":
                backoff = BACKOFF_AFTER_FAILURE * settings.live_min_gap_seconds
                age = (datetime.now(timezone.utc) - latest.created_at).total_seconds()
                if age < backoff:
                    return (
                        "the last automatic investigation failed (the model providers may be down): "
                        f"waiting {math.ceil(backoff - age)} s before trying again"
                    )
            waiting = session.execute(
                select(func.count())
                .select_from(Investigation)
                .where(
                    Investigation.status == "queued",
                    Investigation.run_spec["requested_by"].astext == LIVE_ACTOR,
                )
            ).scalar_one()
            queued_total = queue_length(session)
        if waiting >= settings.live_max_queued:
            return (
                "an automatic investigation is already waiting for a free debate slot"
                if waiting == 1
                else f"{waiting} automatic investigations are already waiting for a free debate slot"
            )
        if queued_total >= settings.debate_queue_max_total:
            return "the debate queue is full"
        if daily_runs(LIVE_CAP_SCOPE, GLOBAL_CAP_IDENTIFIER) >= settings.live_daily_cap:
            return f"the daily limit for automatic investigations is reached ({settings.live_daily_cap})"
        if daily_runs("debate_global", GLOBAL_CAP_IDENTIFIER) >= settings.debate_daily_limit_global:
            return "the daily debate limit across all analysts is reached"
        return None

    @staticmethod
    def _open_investigation(flag: Flag):
        """Creates the queued investigation for a flagged window, or None when its rows are gone."""
        with SessionLocal() as session:
            rows = list(session.execute(select(RawLog).where(RawLog.row_id.in_(flag.row_ids))).scalars())
        by_id = {row.row_id: row for row in rows}
        features = dict(zip(flag.row_ids, flag.features, strict=True))
        ordered = [by_id[row_id] for row_id in flag.row_ids if row_id in by_id]
        if not ordered:
            return None
        ranked = rank_rows(flag.group, ordered, [features[row.row_id] for row in ordered])
        primary_agent, primary_rows = dominant_agent_for_rows(ranked)
        chosen = primary_rows[:MAX_ROWS_PER_AGENT]
        return start_investigation(
            trigger_type="continuous",
            trigger_reason=flag.score.rule,
            scenario_label=evaluation_label([row.row_id for row in chosen]),
            primary_agent=primary_agent,
            noise_pct=0,
            effective_noise_pct=0.0,
            injected_row_ids=[],
            started_by=LIVE_ACTOR,
            max_rows_per_agent=MAX_ROWS_PER_AGENT,
            run_spec=build_run_spec(
                primary_agent=primary_agent,
                row_ids=[row.row_id for row in chosen],
                scenario_row_ids=[row.row_id for row in ordered],
                max_rows_per_agent=MAX_ROWS_PER_AGENT,
                requested_by=LIVE_ACTOR,
            ),
        )


runner = LiveRunner()
