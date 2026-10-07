from sqlalchemy import select

from backend.db.audit import verify_chain
from backend.db.models import AuditTrail, Investigation, RawLog, ResponseAction
from backend.self_healing.actions import respond_to_verdict, should_respond


def _new_investigation(db_session) -> Investigation:
    inv = Investigation(trigger_type="manual")
    db_session.add(inv)
    db_session.flush()
    return inv


def _verdict(verdict_class="ddos", confidence=0.9, status="verdict_reached", evidence=None, agents=None):
    return {
        "verdict_class": verdict_class,
        "verdict_confidence": confidence,
        "status": status,
        "supporting_evidence": evidence or [],
        "contributing_agents": agents or ["network_traffic"],
    }


def test_should_respond_true_when_both_conditions_met():
    assert should_respond(_verdict(confidence=0.85), {"network_traffic": 0.6}) is True


def test_should_respond_false_when_confidence_too_low():
    assert should_respond(_verdict(confidence=0.5), {"network_traffic": 0.6}) is False


def test_should_respond_false_when_any_agent_below_credibility_threshold():
    assert should_respond(_verdict(confidence=0.9), {"network_traffic": 0.6, "access_log": 0.1}) is False


def test_should_respond_false_when_status_is_ambiguous():
    assert should_respond(_verdict(confidence=0.9, status="ambiguous"), {"network_traffic": 0.6}) is False


def test_should_respond_false_when_no_agents():
    assert should_respond(_verdict(confidence=0.9), {}) is False


def test_should_respond_uses_injected_thresholds():
    assert should_respond(_verdict(confidence=0.7), {"network_traffic": 0.6}) is False  # default 0.80
    assert (
        should_respond(_verdict(confidence=0.7), {"network_traffic": 0.6}, confidence_threshold=0.6) is True
    )
    assert should_respond(_verdict(confidence=0.9), {"network_traffic": 0.2}) is False  # default 0.30
    assert (
        should_respond(_verdict(confidence=0.9), {"network_traffic": 0.2}, credibility_threshold=0.1) is True
    )


def test_respond_to_verdict_no_action_when_gate_not_met(db_session):
    inv = _new_investigation(db_session)
    db_session.commit()
    actions = respond_to_verdict(inv.investigation_id, _verdict(confidence=0.5), {"network_traffic": 0.6})
    assert actions == []
    assert db_session.execute(select(ResponseAction)).scalars().all() == []


def test_respond_to_verdict_external_class_triggers_block_and_rate_limit_and_audit(db_session, monkeypatch):
    row = RawLog(
        timestamp="2020-01-01T00:00:00+00:00",
        source="cicids2017",
        event_type="network_flow",
        host_id="10.0.0.5",
        raw_fields={},
        ground_truth_label="benign",
    )
    db_session.add(row)
    db_session.commit()

    inv = _new_investigation(db_session)
    db_session.commit()

    monkeypatch.setattr(
        "backend.self_healing.actions._generate_reason",
        lambda *a, **kw: "Mocked reason text.",
    )

    verdict = _verdict(
        verdict_class="ddos",
        confidence=0.9,
        evidence=[{"row_id": str(row.row_id), "field": "x", "value": "y"}],
    )
    actions = respond_to_verdict(inv.investigation_id, verdict, {"network_traffic": 0.6})

    action_types = {a["action_type"] for a in actions}
    assert action_types == {"block_ip_range", "trigger_rate_limiting", "trigger_audit"}
    assert all(a["target"] == "10.0.0.5" for a in actions)

    persisted = db_session.execute(select(ResponseAction)).scalars().all()
    assert len(persisted) == 3
    assert all(p.is_simulated is True for p in persisted)
    assert all(p.reason == "Mocked reason text." for p in persisted)

    # SKILL-architecture.md Section 7: actions also feed the audit trail
    audit_entries = (
        db_session.execute(
            select(AuditTrail).where(AuditTrail.actor == "self_healing").order_by(AuditTrail.created_at)
        )
        .scalars()
        .all()
    )
    assert len(audit_entries) == 3
    assert {e.action for e in audit_entries} == {"block_ip_range", "trigger_rate_limiting", "trigger_audit"}
    all_entries = db_session.execute(select(AuditTrail).order_by(AuditTrail.seq)).scalars().all()
    assert verify_chain(all_entries) is True


def test_respond_to_verdict_honours_injected_confidence_threshold(db_session, monkeypatch):
    inv = _new_investigation(db_session)
    db_session.commit()
    monkeypatch.setattr(
        "backend.self_healing.actions._generate_reason",
        lambda *a, **kw: "Mocked reason text.",
    )

    actions = respond_to_verdict(
        inv.investigation_id,
        _verdict(verdict_class="ddos", confidence=0.7),
        {"network_traffic": 0.6},
        confidence_threshold=0.6,
    )

    assert {a["action_type"] for a in actions} == {"block_ip_range", "trigger_rate_limiting", "trigger_audit"}


def test_respond_to_verdict_insider_class_triggers_lock_and_audit(db_session, monkeypatch):
    row = RawLog(
        timestamp="2020-01-01T00:00:00+00:00",
        source="cert_r4.2_file",
        event_type="file_access",
        user_id="AAM0658",
        raw_fields={},
        ground_truth_label="benign",
    )
    db_session.add(row)
    db_session.commit()

    inv = _new_investigation(db_session)
    db_session.commit()

    monkeypatch.setattr(
        "backend.self_healing.actions._generate_reason",
        lambda *a, **kw: "Mocked reason text.",
    )

    verdict = _verdict(
        verdict_class="insider_file_exfiltration",
        confidence=0.85,
        evidence=[{"row_id": str(row.row_id), "field": "x", "value": "y"}],
    )
    actions = respond_to_verdict(inv.investigation_id, verdict, {"access_log": 0.7})

    action_types = {a["action_type"] for a in actions}
    assert action_types == {"lock_account", "trigger_audit"}
    lock_action = next(a for a in actions if a["action_type"] == "lock_account")
    assert lock_action["target"] == "AAM0658"


def test_generate_reason_falls_back_on_llm_failure(monkeypatch):
    """Self-healing must never be blocked by a flaky LLM call for auxiliary
    reason text - see actions.py's _generate_reason docstring/try-except.
    """
    from backend.self_healing.actions import _generate_reason

    class FailingClient:
        def complete(self, *args, **kwargs):
            raise RuntimeError("provider down")

    monkeypatch.setattr("backend.self_healing.actions.GeminiClient", FailingClient)

    reason = _generate_reason("ddos", 0.9, [0.6], "block_ip_range", "10.0.0.5")
    assert "ddos" in reason
    assert "block_ip_range" in reason
    assert "10.0.0.5" in reason


def test_respond_to_verdict_benign_class_takes_no_action(db_session):
    inv = _new_investigation(db_session)
    db_session.commit()
    actions = respond_to_verdict(
        inv.investigation_id,
        _verdict(verdict_class="benign", confidence=0.95),
        {"network_traffic": 0.6},
    )
    assert actions == []
