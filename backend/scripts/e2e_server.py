"""Test-only E2E harness: a deterministic LLM stub plus the real API app.

Test tooling. The application never imports this module. It replaces GroqClient.complete and
GeminiClient.complete at class level, so the real investigator agents, debate engine and Watchdog run
unchanged. The stub is offline (no sockets, no provider calls) and scenario-blind: it reads only the
agent's system prompt and data slice, never a label or a noise setting.

  python -m backend.scripts.e2e_server --port 8000   serve backend.api.main:app with the stub
  python -m backend.scripts.e2e_server --selftest    validate the stub's output against AgentResponse
"""

import argparse
import json
import math
import re
import sys
import threading
import uuid
from collections.abc import Callable
from datetime import datetime, timezone

from fastapi import FastAPI

from backend.agents import access_log, endpoint_behavior, network_traffic
from backend.agents.llm_clients import GeminiClient, GroqClient
from backend.db.models import RawLog

# Stubbed complete() calls per provider. Served by GET /__e2e/stub-calls.
CALLS: dict[str, int] = {"groq": 0, "gemini": 0}
_calls_lock = threading.Lock()

AGENTS = {
    "network_traffic": network_traffic,
    "access_log": access_log,
    "endpoint_behavior": endpoint_behavior,
}

_CONFIDENCE = {"network_traffic": 0.70, "access_log": 0.72, "endpoint_behavior": 0.74}

# Canned theories per domain and round; rounds 2 and 3 open with the stance the prompt requires.
# Round-3 wording is chosen so classify_theory() (backend/debate/verdict.py) reads network_traffic as
# ddos and the two insider agents as insider_file_exfiltration, so the debate reaches a verdict class.
_THEORIES = {
    "network_traffic": {
        1: (
            "Volumetric flood pattern: Flow Packets/s and Flow Bytes/s sit far above the window baseline, "
            "which fits a traffic flood aimed at one destination."
        ),
        2: (
            "CHALLENGE: Access-Log's file-exfiltration reading does not explain a packet-rate spike at the "
            "network layer, so the flood explanation stays on the table."
        ),
        3: (
            "REVISE: I narrow the volumetric flood theory to the destination with the highest "
            "packets-per-second share, because byte totals alone cannot separate a flood from bulk transfer."
        ),
    },
    "access_log": {
        1: (
            "Unusual file access and exfiltration: this user's file-access summaries show many distinct "
            "filenames and a file_access_count well above their own usual level."
        ),
        2: (
            "SUPPORT: Endpoint-Behavior's off-hours logon anomaly matches my file-access burst, since "
            "the same user-days also show activity outside working hours."
        ),
        3: (
            "SUPPORT: I keep the unusual file access and exfiltration theory, and the off-hours logon "
            "anomaly from Endpoint-Behavior corroborates the timing of these reads."
        ),
    },
    "endpoint_behavior": {
        1: (
            "Off-hours logon anomaly: logon rows fall outside this user's own historical login hours, and "
            "device activity appears on a PC they rarely use."
        ),
        2: (
            "REVISE: I keep the off-hours logon anomaly and now link it to Access-Log's unusual file access, "
            "because the same user-days show both timing and file-volume outliers."
        ),
        3: (
            "SUPPORT: Access-Log's unusual file access and exfiltration theory matches the off-hours logon "
            "anomaly in my slice, so I support the insider reading of these user-days."
        ),
    },
}

_STANCE = re.compile(r"^(SUPPORT|CHALLENGE|REVISE):")
# Never cited, never read as evidence: ground-truth labels and noise settings.
_NEVER_CITED = frozenset(
    {"row_id", "ground_truth_label", "scenario_label", "noise_pct", "effective_noise_pct"}
)
_FALLBACK_TEXT = "Stub justification (test harness): containment action recorded for the audit trail."


def _agent_of(system_prompt: str) -> str | None:
    for agent_id in AGENTS:
        if f'"agent_id": "{agent_id}"' in system_prompt:
            return agent_id
    return None


def _round_of(user_prompt: str) -> int:
    match = re.search(r"^Round: (\d+)$", user_prompt, re.MULTILINE)
    if match is None:
        raise ValueError("stub: prompt has no 'Round: N' line")
    return int(match.group(1))


def _data_slice(user_prompt: str) -> list[dict]:
    """The JSON array right after the 'Your data slice' header (the same layout in all three agents)."""
    chunks = user_prompt.split("\n\n")
    for i in range(len(chunks) - 1):
        if chunks[i].startswith("Your data slice"):
            rows = json.loads(chunks[i + 1])
            if not rows:
                raise ValueError("stub: data slice is empty")
            return rows
    raise ValueError("stub: prompt has no 'Your data slice' section")


def _citation(row: dict) -> dict | None:
    """One citation copied from the prompt, so the Watchdog's exact match holds: user_id when the row has
    one (the Watchdog checks it against the row's own column), otherwise the row's first scalar raw field.
    """
    user_id = row.get("user_id")
    if isinstance(user_id, str) and user_id:
        return {"row_id": row["row_id"], "field": "user_id", "value": user_id}
    for key, value in row.items():
        if key in _NEVER_CITED or value is None or isinstance(value, bool):
            continue
        if isinstance(value, float) and not math.isfinite(value):
            continue
        if isinstance(value, (str, int, float)) and str(value):
            return {"row_id": row["row_id"], "field": key, "value": str(value)}
    return None


def _cited_evidence(rows: list[dict]) -> list[dict]:
    cited = [c for c in (_citation(row) for row in rows[:2]) if c is not None]
    if not cited:
        raise ValueError("stub: no citable field in the data slice")
    return cited


def fake_reply(system_prompt: str, user_prompt: str) -> str:
    """The stub's answer to one prompt. A pure function of the two prompt strings."""
    agent_id = _agent_of(system_prompt)
    if agent_id is None:
        return _FALLBACK_TEXT
    round_no = _round_of(user_prompt)
    return json.dumps(
        {
            "agent_id": agent_id,
            "theory": _THEORIES[agent_id][min(round_no, 3)],
            "confidence": _CONFIDENCE[agent_id],
            "cited_evidence": _cited_evidence(_data_slice(user_prompt)),
            "round": round_no,
        }
    )


_originals: dict[str, tuple[type, Callable[..., str]]] = {}


def _stub_complete(provider: str) -> Callable[..., str]:
    def complete(self: object, system_prompt: str, user_prompt: str) -> str:
        with _calls_lock:
            CALLS[provider] += 1
        return fake_reply(system_prompt, user_prompt)

    return complete


def install() -> None:
    """Replace complete() on both provider clients at class level. Idempotent."""
    for cls in (GroqClient, GeminiClient):
        if cls.name not in _originals:
            _originals[cls.name] = (cls, cls.__dict__["complete"])
            cls.complete = _stub_complete(cls.name)


def uninstall() -> None:
    while _originals:
        _, (cls, original) = _originals.popitem()
        cls.complete = original


def stub_calls() -> dict[str, int]:
    with _calls_lock:
        return dict(CALLS)


def add_stub_route(app: FastAPI) -> None:
    app.add_api_route("/__e2e/stub-calls", stub_calls, methods=["GET"])


def _row(source: str, event_type: str, user_id: str | None, host_id: str, raw_fields: dict) -> RawLog:
    return RawLog(
        row_id=uuid.uuid4(),
        timestamp=datetime(2010, 1, 4, tzinfo=timezone.utc),
        source=source,
        event_type=event_type,
        user_id=user_id,
        host_id=host_id,
        raw_fields=raw_fields,
    )


def sample_rows(agent_id: str) -> list[RawLog]:
    """Synthetic rows shaped like each agent's real raw_fields (backend/pipeline/normalization.py)."""
    if agent_id == "network_traffic":
        return [
            _row("cicids2017", "network_flow", None, "192.168.10.5", fields)
            for fields in (
                {"Destination Port": 80, "Flow Packets/s": 15234.5, "Flow Bytes/s": 9876543.25},
                {"Destination Port": 80, "Flow Packets/s": 14877.0, "Flow Bytes/s": 9650012.5},
                {"Destination Port": 443, "Flow Packets/s": 3.5, "Flow Bytes/s": 812.0},
            )
        ]
    if agent_id == "access_log":
        return [
            _row("cert_r4.2_file", "file_access", user, "PC-0042", fields)
            for user, fields in (
                ("ACM2278", {"file_access_count": 42, "distinct_filenames": 37, "user_department": "R2"}),
                ("CDE1846", {"file_access_count": 3, "distinct_filenames": 2, "user_department": "R1"}),
                ("DTA0024", {"file_access_count": 9, "distinct_filenames": 8, "user_department": "R2"}),
            )
        ]
    return [
        _row("cert_r4.2_logon", "logon", user, "PC-0042", fields)
        for user, fields in (
            ("ACM2278", {"logon_count": 3, "off_hours": True, "distinct_pcs": 2}),
            ("CDE1846", {"logon_count": 2, "off_hours": False, "distinct_pcs": 1}),
            ("DTA0024", {"logon_count": 4, "off_hours": True, "distinct_pcs": 3}),
        )
    ]


def selftest() -> None:
    """Runs each real investigator (investigate() validates schema and row grounding) for rounds 1-3
    against the stub. Raises RuntimeError on any invalid output, otherwise prints OK."""
    install()
    for agent_id, module in AGENTS.items():
        rows = sample_rows(agent_id)
        for round_no in (1, 2, 3):
            context = None if round_no == 1 else "Prior round context: (self-test)"
            response, provider = module.investigate(
                rows, round_no=round_no, peripheral_digest={"note": "self-test"}, debate_context=context
            )
            if response.agent_id != agent_id or response.round != round_no:
                raise RuntimeError(f"{agent_id} round {round_no}: wrong agent_id or round")
            if round_no > 1 and not _STANCE.match(response.theory):
                raise RuntimeError(f"{agent_id} round {round_no}: theory has no stance prefix")
            print(f"{agent_id} round {round_no}: provider={provider} cited={len(response.cited_evidence)}")
    print("OK")


def serve(host: str, port: int) -> None:
    import uvicorn

    from backend.api.main import app

    install()
    add_stub_route(app)
    print(
        "e2e_server: LLM stub installed for GroqClient and GeminiClient; counts at /__e2e/stub-calls",
        flush=True,
    )
    uvicorn.run(app, host=host, port=port)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="E2E harness: LLM stub plus the real API (test tooling only)."
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--selftest", action="store_true", help="validate the stub's output, then exit")
    args = parser.parse_args(argv)
    if args.selftest:
        selftest()
    else:
        serve(args.host, args.port)
    return 0


if __name__ == "__main__":
    sys.exit(main())
