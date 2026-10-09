import uuid

import pytest

from backend.watchdog.credibility import (
    ETA,
    ISOLATION_THRESHOLD,
    STARTING_CRS,
    _client,
    _crs_key,
    compute_crs,
    get_crs,
    is_isolated,
    reset_agent,
    update_crs,
)


def _fresh_agent_id() -> str:
    # unique per test so Redis state (not truncated by the Postgres db_session
    # fixture) never leaks between tests
    return f"test_agent_{uuid.uuid4().hex[:8]}"


def test_get_crs_defaults_to_starting_value_for_unknown_agent():
    assert get_crs(_fresh_agent_id()) == STARTING_CRS


def test_compute_crs_matches_spec_for_each_rate():
    assert compute_crs(0.5, 1.0, 0.15) == pytest.approx(0.575)  # rate 1 grows CrS by eta
    assert compute_crs(0.5, 0.5, 0.15) == pytest.approx(0.5)  # rate 0.5 leaves CrS unchanged
    assert compute_crs(0.5, 0.0, 0.15) == pytest.approx(0.425)  # rate 0 shrinks CrS by eta


def test_compute_crs_clamps_to_unit_interval():
    assert compute_crs(0.95, 1.0, 0.5) == 1.0
    # with eta > 1 the factor 1 + eta * (2 * 0 - 1) is negative, so the lower clamp applies
    assert compute_crs(0.5, 0.0, 2.0) == 0.0


def test_compute_crs_rejects_rate_outside_unit_interval():
    with pytest.raises(ValueError):
        compute_crs(0.5, 1.5, 0.15)


def test_update_crs_formula_matches_spec():
    agent_id = _fresh_agent_id()
    crs_before, crs_after, isolated = update_crs(agent_id, rate=1.0)
    assert crs_before == STARTING_CRS
    assert crs_after == pytest.approx(STARTING_CRS * (1 + ETA))
    assert isolated is False
    assert get_crs(agent_id) == pytest.approx(crs_after)


def test_update_crs_clamped_to_zero_one():
    agent_id = _fresh_agent_id()
    # drive CrS up repeatedly with perfect verification - must never exceed 1.0
    for _ in range(50):
        _, crs_after, _ = update_crs(agent_id, rate=1.0)
    assert crs_after == 1.0


def test_rate_half_leaves_crs_unchanged():
    agent_id = _fresh_agent_id()
    for _ in range(5):
        _, crs_after, isolated = update_crs(agent_id, rate=0.5)
        assert crs_after == pytest.approx(STARTING_CRS)
        assert isolated is False


def test_three_failing_rounds_from_starting_crs_isolate():
    """Rate 0 shrinks CrS by eta each round. From 0.5 with the default eta 0.20 the second failing
    round is still above the 0.30 threshold (0.32) and the third drops below it (0.256), so an agent
    none of whose citations verify for a whole 3-round debate is isolated when round 3 is scored.
    """
    assert (STARTING_CRS, ETA, ISOLATION_THRESHOLD) == (0.5, 0.20, 0.30)
    agent_id = _fresh_agent_id()
    for failing_round in range(1, 3):
        _, crs_after, isolated = update_crs(agent_id, rate=0.0)
        assert crs_after == pytest.approx(STARTING_CRS * (1 - ETA) ** failing_round)
        assert isolated is False
    _, crs_after, isolated = update_crs(agent_id, rate=0.0)
    assert crs_after == pytest.approx(0.256)
    assert crs_after < ISOLATION_THRESHOLD
    assert isolated is True
    assert is_isolated(agent_id) is True


def test_partly_failing_rounds_do_not_isolate_within_one_debate():
    """Rate 0.25 (a quarter of the citations verify) shrinks CrS by eta/2 per round: 0.45, 0.405, 0.3645.
    Isolation is for agents whose citations mostly fail, not for a single bad round.
    """
    agent_id = _fresh_agent_id()
    for _ in range(3):
        _, crs_after, isolated = update_crs(agent_id, rate=0.25)
        assert isolated is False
    assert crs_after == pytest.approx(STARTING_CRS * (1 - ETA / 2) ** 3)


def test_isolation_mechanism_works_when_crs_is_already_below_threshold():
    agent_id = _fresh_agent_id()
    _client().set(_crs_key(agent_id), 0.25)  # below threshold, set directly

    _, crs_after, isolated = update_crs(agent_id, rate=0.5)
    assert crs_after == pytest.approx(0.25)  # rate 0.5 leaves CrS unchanged
    assert isolated is True
    assert is_isolated(agent_id) is True


def test_isolation_threshold_is_a_parameter():
    agent_id = _fresh_agent_id()
    _client().set(_crs_key(agent_id), 0.25)

    # 0.25 * 1.15 = 0.2875: below the default 0.30, but above a lower threshold of 0.20
    _, crs_after, isolated = update_crs(agent_id, rate=1.0, isolation_threshold=0.2)
    assert crs_after == pytest.approx(0.25 * (1 + ETA))
    assert isolated is False


def test_eta_is_a_parameter():
    agent_id = _fresh_agent_id()
    _, crs_after, _ = update_crs(agent_id, rate=0.0, eta=0.5)
    assert crs_after == pytest.approx(0.25)


def test_reset_agent_restores_neutral_state():
    agent_id = _fresh_agent_id()
    _client().set(_crs_key(agent_id), 0.10)
    update_crs(agent_id, rate=0.0)
    assert is_isolated(agent_id) is True

    reset_agent(agent_id)
    assert is_isolated(agent_id) is False
    assert get_crs(agent_id) == STARTING_CRS


def test_concurrent_updates_of_one_agent_all_count():
    """The update is atomic: 40 threads each apply one rate-1 round at the same moment, and the result is the
    same as applying them one after the other. A get-then-set loses updates and ends lower."""
    import threading

    agent_id = _fresh_agent_id()
    eta = 0.01
    results: list[tuple[float, float, bool]] = []
    start = threading.Barrier(40)

    def one_round() -> None:
        start.wait()
        results.append(update_crs(agent_id, rate=1.0, eta=eta))

    threads = [threading.Thread(target=one_round) for _ in range(40)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    expected = STARTING_CRS
    for _ in range(40):
        expected = compute_crs(expected, 1.0, eta)
    assert get_crs(agent_id) == pytest.approx(expected)
    # every update saw the value the previous one wrote: the "before" values are the chain 0.5, 0.505, ...
    befores = sorted(before for before, _, _ in results)
    assert len(set(befores)) == 40
