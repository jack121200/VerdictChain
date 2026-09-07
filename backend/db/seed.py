"""Tiny sample dataset touching every table — for local dev sanity checks, not for tests
(tests build their own fixtures and truncate independently, see backend/tests/conftest.py).
"""

from datetime import datetime, timedelta, timezone

from backend.db.audit import compute_entry_hash
from backend.db.models import (
    AnalystFeedback,
    AuditTrail,
    CredibilityLog,
    DebateTranscript,
    Investigation,
    ModelVersion,
    RawLog,
    ResponseAction,
)
from backend.db.session import SessionLocal

AGENTS = ["network_traffic", "access_log", "endpoint_behavior"]


def seed() -> None:
    session = SessionLocal()
    try:
        now = datetime.now(timezone.utc)

        logs = [
            RawLog(
                timestamp=now - timedelta(minutes=i),
                source="cicids2017",
                source_file="verdictchain_network_dataset.csv",
                event_type="network_flow",
                host_id=f"10.0.0.{i}",
                raw_fields={"destination_port": 445, "flow_bytes_s": 1200.5 + i},
                ground_truth_label="benign" if i else "port_scan",
            )
            for i in range(5)
        ]
        session.add_all(logs)
        session.flush()

        investigation = Investigation(
            trigger_type="manual",
            trigger_reason="seed sample",
            scenario_label="port_scan",
            status="verdict_reached",
            verdict_class="port_scan",
            verdict_confidence=0.82,
        )
        session.add(investigation)
        session.flush()

        for round_no in range(1, 3):
            for agent_id in AGENTS:
                session.add(
                    DebateTranscript(
                        investigation_id=investigation.investigation_id,
                        round=round_no,
                        agent_id=agent_id,
                        theory="Sample theory for seed data.",
                        confidence=0.7,
                        cited_evidence=[
                            {"row_id": str(logs[0].row_id), "field": "destination_port", "value": "445"}
                        ],
                    )
                )
                session.add(
                    CredibilityLog(
                        investigation_id=investigation.investigation_id,
                        agent_id=agent_id,
                        round=round_no,
                        crs_before=0.5,
                        crs_after=0.55,
                        verification_match_rate=1.0,
                        isolated=False,
                    )
                )

        session.add(
            ResponseAction(
                investigation_id=investigation.investigation_id,
                action_type="block_ip_range",
                target="10.0.0.0/24",
                reason="Seed sample containment action.",
                is_simulated=True,
            )
        )

        session.add(ModelVersion(accuracy=0.91, false_positive_rate=0.04, is_deployed=True, notes="seed baseline"))

        session.add(AnalystFeedback(investigation_id=investigation.investigation_id, verdict_was_correct=True))

        h1 = compute_entry_hash("watchdog", "credibility_update", {"agent_id": "network_traffic"}, None)
        entry1 = AuditTrail(
            investigation_id=investigation.investigation_id,
            actor="watchdog",
            action="credibility_update",
            detail={"agent_id": "network_traffic"},
            prev_hash=None,
            entry_hash=h1,
        )
        session.add(entry1)
        session.flush()

        h2 = compute_entry_hash("self_healing", "response_action", {"action_type": "block_ip_range"}, h1)
        session.add(
            AuditTrail(
                investigation_id=investigation.investigation_id,
                actor="self_healing",
                action="response_action",
                detail={"action_type": "block_ip_range"},
                prev_hash=h1,
                entry_hash=h2,
            )
        )

        session.commit()
        print(f"Seeded investigation {investigation.investigation_id} with {len(logs)} raw_logs rows.")
    finally:
        session.close()


if __name__ == "__main__":
    seed()
