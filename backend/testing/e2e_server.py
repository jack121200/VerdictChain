"""Test-only E2E harness: a deterministic LLM stub plus the real API app.

Test tooling. The application never imports this module. It replaces OpenAIClient.complete and
OpenAIClient.complete_text at class level, so the real investigator agents, the debate engine and the
Watchdog run unchanged. The stub is offline (no sockets, no provider calls) and scenario-blind: it reads
only the agent's system prompt and data slice, never a label or a noise setting.

  python -m backend.testing.e2e_server --port 8000   serve backend.api.main:app with the stub
  python -m backend.testing.e2e_server --selftest    validate the stub's output against AgentResponse
  python -m backend.testing.e2e_server --fabricate access_log
                                                     serve with a hallucinating agent (see below)

Fabricate mode makes the named agents cite real rows with values that do not match them, like a model that
invents evidence. Nothing about the Watchdog is stubbed: it scores those rounds at match rate 0, so the real
credibility update, isolation, quarantine and audit code runs end to end.
"""

import argparse
import json
import math
import re
import sys
import threading
import uuid
from collections.abc import Callable, Iterable
from datetime import datetime, timezone

import redis
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from backend.agents import access_log, endpoint_behavior, network_traffic, openai_usage
from backend.agents.llm_clients import OpenAIClient, ProviderRateLimited
from backend.db.models import RawLog

# Stubbed complete() calls per provider. Served by GET /__e2e/stub-calls.
CALLS: dict[str, int] = {"openai": 0}
_calls_lock = threading.Lock()

AGENTS = {
    "network_traffic": network_traffic,
    "access_log": access_log,
    "endpoint_behavior": endpoint_behavior,
}

_CONFIDENCE = {"network_traffic": 0.88, "access_log": 0.86, "endpoint_behavior": 0.90}

# Agents whose cited VALUES are corrupted. The row ids stay real (the agent layer rejects unknown ids), the
# value never matches the row, so the Watchdog's exact match fails for every citation of that agent.
_FABRICATED_VALUE = "stub-fabricated-value"
_fabricate: frozenset[str] = frozenset()

# While on, the investigators' model calls fail the way an account with no quota left fails (a daily 429), so
# the failure path of a debate can be driven end to end. The wording the analyst reads is the real code's.
_quota_exhausted = False

# Each agent states its own class, as the prompts ask (network_traffic -> ddos, access_log ->
# insider_file_exfiltration, endpoint_behavior -> insider_logon_anomaly). With one vote each, the verdict's
# primary-agent tie-break then resolves to the class of whichever agent actually held the injected
# scenario's rows. The round-3 wording also reads as the same class to the keyword list in
# backend/debate/verdict.py, so the stated and the keyword reading agree (a test keeps it so).
_VOTE_CLASS = {
    "network_traffic": "ddos",
    "access_log": "insider_file_exfiltration",
    "endpoint_behavior": "insider_logon_anomaly",
}

# Canned theories per domain and round; rounds 2 and 3 open with the stance the prompt requires.
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
            "REVISE: I hold the off-hours logon anomaly reading - the logon rows for these user-days fall "
            "outside this user's own historical login hours and an unrecognized device appears, which is an "
            "unusual login pattern rather than a file-exfiltration one."
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
    cited = _cited_evidence(_data_slice(user_prompt))
    if agent_id in _fabricate:
        cited = [{**entry, "value": _FABRICATED_VALUE} for entry in cited]
    theory = _THEORIES[agent_id][min(round_no, 3)]
    stance = _STANCE.match(theory)
    return json.dumps(
        {
            "agent_id": agent_id,
            "theory": theory,
            "confidence": _CONFIDENCE[agent_id],
            "stance": stance.group(1) if stance else None,
            "vote_class": _VOTE_CLASS[agent_id],
            "cited_evidence": cited,
            "round": round_no,
        }
    )


# class name -> (class, original complete, original provider name). Keyed by class so install() stays
# idempotent even though the provider name changes while the stub is installed.
_originals: dict[str, tuple[type, Callable[..., str], str]] = {}


def _stub_complete(provider: str) -> Callable[..., str]:
    def complete(self: object, system_prompt: str, user_prompt: str) -> str:
        with _calls_lock:
            CALLS[provider] += 1
        if _quota_exhausted:
            raise ProviderRateLimited(provider, 429, None, daily=True)
        return fake_reply(system_prompt, user_prompt)

    return complete


def _stub_complete_text(provider: str) -> Callable[..., str]:
    def complete_text(
        self: object, system_prompt: str, user_prompt: str, max_output_tokens: int = 120
    ) -> str:
        with _calls_lock:
            CALLS[provider] += 1
        # The reason prompt lists the actions as numbered lines: answer one numbered sentence for each.
        actions = len(re.findall(r"^\d+\. ", user_prompt, re.MULTILINE))
        if actions == 0:
            return _FALLBACK_TEXT
        return "\n".join(f"{number}. {_FALLBACK_TEXT}" for number in range(1, actions + 1))

    return complete_text


_text_original: Callable[..., str] | None = None


def install() -> None:
    """Replace complete() and complete_text() on the OpenAI client at class level. Idempotent.

    While installed, the client reports itself as "stub-openai". The provider name is what the debate engine
    records on every transcript row and shows in the console, so data produced by this harness is honestly
    labelled as stub output and can never pass for a real model call. complete_text() is the reason sentence.
    """
    global _text_original
    cls = OpenAIClient
    if cls.__name__ not in _originals:
        real_name = cls.name
        _originals[cls.__name__] = (cls, cls.__dict__["complete"], real_name)
        cls.complete = _stub_complete(real_name)
        cls.name = f"stub-{real_name}"
        _text_original = cls.__dict__["complete_text"]
        cls.complete_text = _stub_complete_text(real_name)


def uninstall() -> None:
    global _text_original
    while _originals:
        _, (cls, original, real_name) = _originals.popitem()
        cls.complete = original
        cls.name = real_name
        if _text_original is not None:
            cls.complete_text = _text_original
            _text_original = None
    set_fabricate(())
    set_quota_exhausted(False)


def set_fabricate(agent_ids: Iterable[str]) -> list[str]:
    """Makes exactly these investigators cite wrong values from now on (an empty iterable turns it off)."""
    global _fabricate
    chosen = frozenset(agent_ids)
    unknown = chosen - set(AGENTS)
    if unknown:
        raise ValueError(f"unknown investigator(s): {sorted(unknown)}")
    _fabricate = chosen
    return sorted(chosen)


def set_quota_exhausted(on: bool) -> bool:
    """Makes the investigators' model calls fail with a daily quota 429 from now on (False turns it off)."""
    global _quota_exhausted
    _quota_exhausted = on
    return _quota_exhausted


def stub_calls() -> dict[str, int]:
    with _calls_lock:
        return dict(CALLS)


class FabricateBody(BaseModel):
    agents: list[str]


class QuotaBody(BaseModel):
    exhausted: bool


def get_quota() -> dict[str, bool]:
    return {"exhausted": _quota_exhausted}


def post_quota(body: QuotaBody) -> dict[str, bool]:
    return {"exhausted": set_quota_exhausted(body.exhausted)}


def get_fabricate() -> dict[str, list[str]]:
    return {"agents": sorted(_fabricate)}


def post_fabricate(body: FabricateBody) -> dict[str, list[str]]:
    try:
        return {"agents": set_fabricate(body.agents)}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def add_stub_route(app: FastAPI) -> None:
    app.add_api_route("/__e2e/stub-calls", stub_calls, methods=["GET"])
    app.add_api_route("/__e2e/fabricate", get_fabricate, methods=["GET"])
    app.add_api_route("/__e2e/fabricate", post_fabricate, methods=["POST"])
    app.add_api_route("/__e2e/quota", get_quota, methods=["GET"])
    app.add_api_route("/__e2e/quota", post_quota, methods=["POST"])


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


def forget_provider_limits() -> None:
    """The stub never calls OpenAI, so what real runs recorded about the key's limits (a spent allowance, a
    wait OpenAI asked for) must not stop it: a debate is refused up front while that reading says the key
    has no room. Clears the reading and the usage list, as a fresh start. Redis being down is no error."""
    try:
        openai_usage.reset()
    except redis.RedisError:
        pass


def serve(host: str, port: int, fabricate: Iterable[str] = ()) -> None:
    import uvicorn

    from backend.api.main import app
    from backend.config import settings as app_settings

    install()
    forget_provider_limits()
    add_stub_route(app)
    if not app_settings.openai_api_key:
        # The app refuses to run a debate without a key; the stub never sends it anywhere.
        app_settings.openai_api_key = "stub-openai-key-never-sent"
    print("e2e_server: LLM stub installed for OpenAIClient; counts at /__e2e/stub-calls", flush=True)
    chosen = set_fabricate(fabricate)
    if chosen:
        print(
            f"e2e_server: fabricate mode ON for {', '.join(chosen)} (their citations will not verify)",
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
    parser.add_argument(
        "--fabricate",
        nargs="+",
        choices=sorted(AGENTS),
        default=[],
        metavar="AGENT",
        help="agents that cite wrong values (a hallucination drill for the Watchdog and isolation)",
    )
    args = parser.parse_args(argv)
    if args.selftest:
        selftest()
    else:
        serve(args.host, args.port, args.fabricate)
    return 0


if __name__ == "__main__":
    sys.exit(main())
