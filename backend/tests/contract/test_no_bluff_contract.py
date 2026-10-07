"""No-bluff contract for the read endpoints (plan section 1, R2 to R7, and section 1 R10).

- Every numeric leaf in /stats, /evaluation, /agents/fleet and /system/status is the `value` of a Metric
  envelope.
- On an empty database every rate or average is null with a reason, and every count is a real 0.
- No blacklisted design literal (plan section 7) appears in any JSON response of these endpoints.
"""

from fastapi.testclient import TestClient

from backend.api.main import app
from backend.tests.fixtures.read_seed import (
    add_action,
    add_credibility,
    add_feedback,
    add_investigation,
    add_raw,
    add_transcript,
    audit,
    bearer_for,
    cite,
)

client = TestClient(app)

METRIC_KEYS = {"value", "n", "as_of", "source", "definition", "reason"}
# A grouping key, not a measurement. It is a label for the noise level (0, 15 or 30).
IDENTIFIER_KEYS = {"noise_pct"}
RATE_LIKE = ("rate", "accuracy", "share", "mean", "brier", "precision", "recall", "f1")

# Plan section 7, verbatim.
BLACKLIST = (
    "99.82",
    "96.2",
    "98.4",
    "94.6",
    "91.4",
    "0.958",
    "142 t/s",
    "14ms",
    "14 ms",
    "0ms",
    "0 ms",
    "120k",
    "RFC-8941",
    "RFC-6962",
    "Merkle",
    "Ed25519",
    "eBPF",
    "SEV-SNP",
    "seccomp",
    "AppArmor",
    "Kerberos",
    "Linode",
    "SanDisk",
    "Sysmon",
    "USENIX",
    "Xu et al",
    "Zero-Trust",
    "Zero Trust",
    "Byzantine",
    "hallucination rate",
    "air-gapped",
    "Apache 2.0",
    "MIT",
    "Enclave",
    "BYPASS",
    "Llama",
    "Gemini 2.5",
    "Gemini 1.5",
    "Claude 3.5",
    "DeepSeek",
    "Protocol 88",
    "Protocol V2.4",
    "Threat Lvl 3",
    "Alert Orange",
    "dev_mgrant",
    "admin_clark99",
    "WS-CORP",
    "VC-8821",
    "VC-4409",
    "INV-2026-",
    "Sentinel Ω",
    "Delta",
    "Epsilon",
)

ENDPOINTS = ("/stats", "/evaluation", "/agents/fleet", "/system/status")
EXTRA_ENDPOINTS = (
    "/scenarios",
    "/investigations",
    "/citations",
    "/audit-trail",
    "/raw-logs/counts",
    "/response-actions",
)


def _is_metric(node: dict) -> bool:
    return METRIC_KEYS <= set(node)


def _violations(node, path: str = "$", key: str | None = None) -> list[str]:
    """Numeric leaves that are not the value of a Metric envelope. Booleans and strings are not numeric."""
    if isinstance(node, dict):
        if _is_metric(node):
            problems = []
            if not isinstance(node["n"], int) or node["n"] < 0:
                problems.append(f"{path}.n is not a non-negative int")
            if node["value"] is None and not node["reason"]:
                problems.append(f"{path} is null without a reason")
            if node["value"] is not None and (
                isinstance(node["value"], bool) or not isinstance(node["value"], int | float)
            ):
                problems.append(f"{path}.value is not numeric")
            return problems
        out: list[str] = []
        for child_key, child in node.items():
            out.extend(_violations(child, f"{path}.{child_key}", child_key))
        return out
    if isinstance(node, list):
        out = []
        for index, child in enumerate(node):
            out.extend(_violations(child, f"{path}[{index}]", key))
        return out
    if isinstance(node, bool) or node is None or isinstance(node, str):
        return []
    if isinstance(node, int | float):
        if key in IDENTIFIER_KEYS:
            return []
        return [f"{path} is a bare number outside a Metric envelope"]
    return []


def _metrics(node, path: str = "$"):
    """Yields (path, metric_dict) for every Metric envelope in the response."""
    if isinstance(node, dict):
        if _is_metric(node):
            yield path, node
            return
        for key, child in node.items():
            yield from _metrics(child, f"{path}.{key}")
    elif isinstance(node, list):
        for index, child in enumerate(node):
            yield from _metrics(child, f"{path}[{index}]")


def _get(path: str, role: str = "forensic_analyst"):
    resp = client.get(path, headers=bearer_for(role))
    assert resp.status_code == 200, (path, resp.status_code, resp.text[:200])
    return resp


def _seed_some_evidence(db_session) -> None:
    row = add_raw(db_session, raw_fields={"Destination Port": 80}, label="DDoS")
    inv = add_investigation(
        db_session, status="verdict_reached", verdict_class="ddos", confidence=0.9, scenario_label="DDoS"
    )
    add_transcript(
        db_session,
        inv.investigation_id,
        round_no=1,
        agent_id="network_traffic",
        theory="SUPPORT: ddos flood",
        cited=[cite(row, "Destination Port", "80"), cite(row, "Destination Port", "81")],
    )
    add_credibility(
        db_session,
        inv.investigation_id,
        agent_id="network_traffic",
        round_no=1,
        before=0.5,
        after=0.4,
        rate=0.5,
    )
    add_action(db_session, inv.investigation_id)
    add_feedback(db_session, inv.investigation_id, True)
    audit(db_session, "watchdog", "credibility_update", {"agent_id": "network_traffic"}, inv.investigation_id)
    db_session.commit()


def test_every_numeric_field_is_a_metric_on_an_empty_database(db_session):
    for path in ENDPOINTS:
        body = _get(path).json()
        assert _violations(body) == [], path


def test_every_numeric_field_is_a_metric_with_seeded_data(db_session):
    _seed_some_evidence(db_session)

    for path in ENDPOINTS:
        body = _get(path).json()
        assert _violations(body) == [], path


def test_rates_and_averages_are_null_with_a_reason_on_an_empty_database(db_session):
    for path in ("/stats", "/evaluation", "/agents/fleet", "/system/status"):
        for metric_path, metric in _metrics(_get(path).json()):
            if any(fragment in metric_path for fragment in RATE_LIKE) and metric["n"] == 0:
                assert metric["value"] is None, (path, metric_path)
                assert metric["reason"], (path, metric_path)


def test_counts_are_real_zeros_on_an_empty_database(db_session):
    body = _get("/stats").json()

    for key in ("active", "stale", "threats_24h", "insider_count", "contained"):
        assert body[key]["value"] == 0, key
    assert body["citations"]["total"]["value"] == 0
    assert body["self_healing"]["actions_total"]["value"] == 0


def test_no_blacklisted_claim_appears_in_any_response(db_session):
    _seed_some_evidence(db_session)
    responses = []
    for path in ENDPOINTS + EXTRA_ENDPOINTS:
        responses.append((path, _get(path).text))

    for path, text in responses:
        for literal in BLACKLIST:
            assert literal not in text, (path, literal)


def test_no_blacklisted_claim_on_an_empty_database(db_session):
    for path in ENDPOINTS + EXTRA_ENDPOINTS:
        text = _get(path).text
        for literal in BLACKLIST:
            assert literal not in text, (path, literal)


def test_the_walker_catches_a_bare_number():
    """The check itself is tested, so a future regression in the walker cannot pass silently."""
    assert _violations({"total": 3}) != []
    assert (
        _violations(
            {"total": {"value": 3, "n": 3, "as_of": "x", "source": "s", "definition": "d", "reason": None}}
        )
        == []
    )
    assert (
        _violations(
            {"rate": {"value": None, "n": 0, "as_of": "x", "source": "s", "definition": "d", "reason": None}}
        )
        != []
    )
    assert _violations({"noise_pct": 15}) == []
