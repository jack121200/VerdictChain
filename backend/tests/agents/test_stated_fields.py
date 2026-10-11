"""The two fields an investigator now states itself (checklist LG2, LG4): its stance and the class it votes
for. The prompts ask for them in the same words, the parser keeps them, and a slip never costs the answer."""

import json

import pytest

from backend.agents import access_log, endpoint_behavior, network_traffic
from backend.agents.base_agent import parse_and_validate
from backend.agents.schemas import STANCES, VOTE_CLASSES, VOTE_FIELDS_RULES

MODULES = (network_traffic, access_log, endpoint_behavior)
ROW = "11111111-1111-1111-1111-111111111111"


def _raw(agent_id: str, **extra) -> str:
    return json.dumps(
        {
            "agent_id": agent_id,
            "theory": "Some theory.",
            "confidence": 0.5,
            "cited_evidence": [{"row_id": ROW, "field": "f", "value": "v"}],
            "round": 2,
            **extra,
        }
    )


@pytest.mark.parametrize("module", MODULES)
def test_every_investigator_asks_for_the_two_fields_in_the_same_words(module):
    assert VOTE_FIELDS_RULES in module.SYSTEM_PROMPT
    schema_line = module.SYSTEM_PROMPT.split("Respond with a single JSON object matching exactly:")[1]
    assert '"stance": null' in schema_line and '"vote_class"' in schema_line
    assert 'Set "stance" to the word you chose' in module._ROUND_2_3_INSTRUCTIONS


def test_the_rules_name_every_class_and_every_stance_the_schema_accepts():
    for name in VOTE_CLASSES + STANCES:
        assert name in VOTE_FIELDS_RULES


def test_the_rules_tell_a_hedging_agent_to_vote_benign_or_ambiguous():
    assert "no clear attack or anomaly" in VOTE_FIELDS_RULES
    assert "never an attack class" in VOTE_FIELDS_RULES


@pytest.mark.parametrize("module", MODULES)
def test_the_prompts_still_name_no_scenario_and_no_label(module):
    for forbidden in ("ground_truth_label", "scenario_label", "noise_pct", "insider_scenario", "SECRET"):
        assert forbidden not in module.SYSTEM_PROMPT


def test_an_answer_with_both_fields_keeps_them():
    response = parse_and_validate(
        _raw("network_traffic", stance="support", vote_class="DDoS"), "network_traffic", 2, {ROW}
    )

    assert (response.stance, response.vote_class) == ("SUPPORT", "ddos")


def test_an_answer_that_copied_the_placeholder_of_the_example_is_still_accepted_without_a_class():
    response = parse_and_validate(
        _raw("access_log", stance=None, vote_class="<one class from the list>"), "access_log", 2, {ROW}
    )

    assert response.vote_class is None  # the server then reads the theory text, as before
    assert response.theory == "Some theory."


def test_an_answer_without_the_fields_is_exactly_as_valid_as_before():
    response = parse_and_validate(_raw("endpoint_behavior"), "endpoint_behavior", 2, {ROW})

    assert (response.stance, response.vote_class) == (None, None)
