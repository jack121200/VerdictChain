"""Shared plumbing for every investigator agent: call the assigned provider with a
fallback to the other one (SKILL-agent-prompts.md Section 7), then validate the
response against the shared schema PLUS grounding — every cited row_id must
actually be one of the rows this agent was given. An LLM inventing a citation
from outside its own data slice is exactly as invalid as citing nothing.
"""

import json
import logging
import time

from pydantic import ValidationError

from backend.agents.llm_clients import LLMProvider
from backend.agents.schemas import AgentResponse

logger = logging.getLogger(__name__)


class InvalidAgentResponse(Exception):
    pass


def _extract_json(raw_text: str) -> dict:
    text = raw_text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise InvalidAgentResponse(f"response was not valid JSON: {exc}") from exc


def call_with_fallback(
    primary: LLMProvider,
    fallback: LLMProvider,
    system_prompt: str,
    user_prompt: str,
    retry_delay_s: float = 5.0,
) -> tuple[str, str]:
    """Returns (raw_text, provider_name_that_served_it). Tries primary, then
    fallback, then (after a short backoff - free-tier 429/503s are often
    resolved within a few seconds) primary again, then fallback again, before
    giving up. Observed live: both providers can hit a transient error in the
    same few seconds (Gemini 503 + Groq 429 back to back), so a single
    primary->fallback pass isn't always enough.
    """
    attempts = [(primary, 0.0), (fallback, 0.0), (primary, retry_delay_s), (fallback, retry_delay_s)]
    last_exc: Exception | None = None

    for provider, delay in attempts:
        if delay:
            time.sleep(delay)
        try:
            return provider.complete(system_prompt, user_prompt), provider.name
        except Exception as exc:  # noqa: BLE001 - genuinely any provider failure should be retried/fall back
            logger.warning("provider %s failed (%s)", provider.name, exc)
            last_exc = exc

    raise last_exc


def parse_and_validate(
    raw_text: str,
    expected_agent_id: str,
    expected_round: int,
    valid_row_ids: set[str],
) -> AgentResponse:
    payload = _extract_json(raw_text)

    # Backfill agent_id/round if the model omitted them (observed live: Groq's
    # openai/gpt-oss-20b dropped "round" from an otherwise-correct response).
    # Safe because we already know the correct value independently of the
    # model's output - this never masks a WRONG value, only a missing one, and
    # doesn't touch citation grounding or cited_evidence at all.
    if isinstance(payload, dict):
        payload.setdefault("agent_id", expected_agent_id)
        payload.setdefault("round", expected_round)

    try:
        response = AgentResponse.model_validate(payload)
    except ValidationError as exc:
        raise InvalidAgentResponse(f"response failed schema validation: {exc}") from exc

    if response.agent_id != expected_agent_id:
        raise InvalidAgentResponse(f"expected agent_id={expected_agent_id!r}, got {response.agent_id!r}")
    if response.round != expected_round:
        raise InvalidAgentResponse(f"expected round={expected_round}, got {response.round}")

    fabricated = [e.row_id for e in response.cited_evidence if e.row_id not in valid_row_ids]
    if fabricated:
        raise InvalidAgentResponse(
            f"cited row_id(s) not present in this agent's own data slice: {fabricated}"
        )

    return response
