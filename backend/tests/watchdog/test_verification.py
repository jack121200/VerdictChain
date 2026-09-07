from backend.agents.schemas import CitedEvidence
from backend.db.models import RawLog
from backend.watchdog.verification import verify_cited_evidence


def _seed_row(db_session, **raw_fields) -> RawLog:
    row = RawLog(
        timestamp="2020-01-01T00:00:00+00:00",
        source="x",
        event_type="network_flow",
        user_id="U1",
        raw_fields=raw_fields,
        ground_truth_label="benign",
    )
    db_session.add(row)
    db_session.flush()
    return row


def test_verify_all_citations_match(db_session):
    row = _seed_row(db_session, **{"Destination Port": 445})
    db_session.commit()

    rate = verify_cited_evidence(
        [CitedEvidence(row_id=str(row.row_id), field="Destination Port", value="445")]
    )
    assert rate == 1.0


def test_verify_citation_with_wrong_value_fails(db_session):
    row = _seed_row(db_session, **{"Destination Port": 445})
    db_session.commit()

    rate = verify_cited_evidence(
        [CitedEvidence(row_id=str(row.row_id), field="Destination Port", value="9999")]
    )
    assert rate == 0.0


def test_verify_citation_to_nonexistent_row_fails():
    rate = verify_cited_evidence(
        [CitedEvidence(row_id="00000000-0000-0000-0000-000000000000", field="x", value="y")]
    )
    assert rate == 0.0


def test_verify_malformed_row_id_fails():
    rate = verify_cited_evidence([CitedEvidence(row_id="not-a-uuid", field="x", value="y")])
    assert rate == 0.0


def test_verify_top_level_field_citation(db_session):
    row = _seed_row(db_session)
    db_session.commit()

    rate = verify_cited_evidence([CitedEvidence(row_id=str(row.row_id), field="user_id", value="U1")])
    assert rate == 1.0


def test_verify_partial_match_rate(db_session):
    row = _seed_row(db_session, **{"Destination Port": 445})
    db_session.commit()

    rate = verify_cited_evidence(
        [
            CitedEvidence(row_id=str(row.row_id), field="Destination Port", value="445"),  # match
            CitedEvidence(row_id=str(row.row_id), field="Destination Port", value="9999"),  # mismatch
        ]
    )
    assert rate == 0.5
