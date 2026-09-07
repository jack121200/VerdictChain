import pytest

from backend.pipeline.cert_ground_truth import ANSWERS_DIR, load_malicious_event_ids, load_malicious_users

pytestmark = pytest.mark.skipif(not ANSWERS_DIR.exists(), reason="CERT answers not extracted yet")


def test_load_malicious_users_matches_real_r42_counts():
    users = load_malicious_users()
    assert len(users) == 70  # real r4.2 count: 30 + 30 + 10, not a made-up number
    scenarios = {label for label in users.values()}
    assert scenarios == {"insider_scenario_1", "insider_scenario_2", "insider_scenario_3"}


def test_load_malicious_event_ids_nonempty_and_labeled():
    ids = load_malicious_event_ids()
    assert len(ids) > 1000
    assert set(ids.values()) <= {"insider_scenario_1", "insider_scenario_2", "insider_scenario_3"}
