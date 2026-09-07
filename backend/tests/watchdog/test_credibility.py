import uuid

from backend.watchdog.credibility import (
    ETA,
    STARTING_CRS,
    _client,
    _crs_key,
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


def test_update_crs_formula_matches_spec():
    agent_id = _fresh_agent_id()
    crs_before, crs_after, isolated = update_crs(agent_id, verification_match_rate=1.0)
    expected = STARTING_CRS * (1 + ETA * 1.0)
    assert crs_before == STARTING_CRS
    assert abs(crs_after - expected) < 1e-9
    assert isolated is False
    assert abs(get_crs(agent_id) - crs_after) < 1e-9


def test_update_crs_clamped_to_zero_one():
    agent_id = _fresh_agent_id()
    # drive CrS up repeatedly with perfect verification - must never exceed 1.0
    for _ in range(50):
        _, crs_after, _ = update_crs(agent_id, verification_match_rate=1.0)
    assert crs_after <= 1.0


def test_repeated_zero_match_rate_never_isolates_agent_from_starting_crs():
    """Documents a real formula defect (flagged in credibility.py's docstring
    and SKILL-data-schema.md, not silently fixed): for rate in [0,1], the
    multiplier (1 + eta*rate) is always >= 1.0, so CrS can only hold flat or
    grow - starting from 0.5, repeated verification failures can NEVER push it
    below the 0.30 isolation threshold. This is the correct (if surprising)
    behavior of the formula as literally specified, not a bug in this test.
    """
    agent_id = _fresh_agent_id()
    isolated = False
    for _ in range(20):
        _, crs_after, isolated = update_crs(agent_id, verification_match_rate=0.0)
        assert crs_after == STARTING_CRS  # never moves at rate=0
    assert isolated is False
    assert is_isolated(agent_id) is False


def test_isolation_mechanism_works_when_crs_is_already_below_threshold():
    """The isolation MECHANISM (detecting crs_after < threshold and setting the
    flag) is correct - it's only the formula's inability to ever produce a
    below-threshold value from the spec's own starting point that's broken.
    Proven here by manipulating Redis directly to simulate a state the formula
    itself cannot reach.
    """
    agent_id = _fresh_agent_id()
    _client().set(_crs_key(agent_id), 0.25)  # below threshold, bypassing the formula

    _, crs_after, isolated = update_crs(agent_id, verification_match_rate=0.0)
    assert crs_after == 0.25  # rate=0 -> unchanged, but already below threshold
    assert isolated is True
    assert is_isolated(agent_id) is True


def test_reset_agent_restores_neutral_state():
    agent_id = _fresh_agent_id()
    _client().set(_crs_key(agent_id), 0.10)
    update_crs(agent_id, verification_match_rate=0.0)
    assert is_isolated(agent_id) is True

    reset_agent(agent_id)
    assert is_isolated(agent_id) is False
    assert get_crs(agent_id) == STARTING_CRS
