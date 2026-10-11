import pytest

from backend.agents.schemas import CitedEvidence
from backend.db.models import RawLog
from backend.db.session import SessionLocal
from backend.watchdog.verification import check_citations, shown_value, value_matches, verify_cited_evidence


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


# ---- what counts as the same value (the investigators read the rows as JSON) ----------------------------


@pytest.mark.parametrize(
    ("cited", "stored"),
    [
        ("false", False),  # a boolean as the prompt showed it ...
        ("False", False),  # ... or as Python prints it
        ("true", True),
        ("0.3", 0.3),
        ("0.30", 0.3),  # the same number written another way
        ("999999", 999999.0),
        ("999999.0", 999999.0),
        ("1e6", 1000000),
        (" 80 ", 80),
        ("445", 445),
        ("SCP0130", "SCP0130"),
    ],
)
def test_a_value_counts_when_it_is_the_stored_one_in_any_of_its_three_forms(cited, stored):
    assert value_matches(cited, stored)


@pytest.mark.parametrize(
    ("cited", "stored"),
    [
        ("true", False),
        ("1", True),  # a number is not a boolean
        ("0", False),
        ("0.31", 0.3),
        ("445", 446),
        ("1 / 1 / 1", 1),  # several fields joined into one citation
        ("false, 1, 1", False),
        ("nan", 1.0),
        ("inf", 1.0),
        ("scp0130", "SCP0130"),  # text is compared as written
        ("445", "446"),
        ("", 0),
    ],
)
def test_a_different_value_is_still_a_discrepancy(cited, stored):
    assert not value_matches(cited, stored)


def test_a_value_is_shown_the_way_the_prompt_shows_it():
    assert shown_value(False) == "false" and shown_value(0.3) == "0.3" and shown_value(80) == "80"
    assert shown_value("abc") == "abc"
    assert shown_value(["a", 1]) == '["a", 1]'


def test_the_check_reports_the_stored_value_as_it_was_shown(db_session):
    row = _seed_row(db_session, off_hours=False, logon_count=2)
    db_session.commit()
    entries = [
        CitedEvidence(row_id=str(row.row_id), field="off_hours", value="false"),
        CitedEvidence(row_id=str(row.row_id), field="logon_count", value="2.0"),
        CitedEvidence(row_id=str(row.row_id), field="logon_count / off_hours", value="2 / false"),
        CitedEvidence(row_id=str(row.row_id), field="logon_count", value="3"),
    ]

    with SessionLocal() as session:
        checks = check_citations(session, entries)

    assert [(c.status, c.reason, c.expected) for c in checks] == [
        ("VERIFIED", "ok", "false"),
        ("VERIFIED", "ok", "2"),
        ("DISCREPANCY", "field_not_found", None),  # a joined field name is not a field of the row
        ("DISCREPANCY", "value_mismatch", "2"),
    ]
