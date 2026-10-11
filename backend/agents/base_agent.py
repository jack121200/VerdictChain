"""Shared plumbing for every investigator agent: call the one provider (OpenAI) with retries for the
failures that can pass, then validate the response against the shared schema PLUS grounding — every cited
row_id must actually be one of the rows this agent was given. An LLM inventing a citation from outside its
own data slice is exactly as invalid as citing nothing.
"""

import json
import logging
import time

import httpx
from pydantic import ValidationError

from backend.agents.llm_clients import LLMProvider, OpenAIUnavailable, ProviderRateLimited
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


def _worth_retrying(exc: Exception) -> bool:
    """A rate limit that waiting can clear, a timeout, a dropped connection or a server error. Not a bad key,
    an unknown model, a spent budget or an account out of credit: those fail at once with their own words."""
    if isinstance(exc, ProviderRateLimited):
        return not exc.daily
    return isinstance(exc, OpenAIUnavailable | httpx.HTTPError)


def call_with_retry(
    provider: LLMProvider,
    system_prompt: str,
    user_prompt: str,
    retry_delay_s: float = 5.0,
    max_rounds: int = 4,
) -> tuple[str, str]:
    """Returns (raw_text, provider_name). A failure that can pass is tried again after an exponential wait
    (retry_delay_s * 2^n, at most 60 s, or the provider's own retry-after hint if that is longer); any other
    failure is raised at once. There is one provider, so there is nothing to fall back to.
    """
    last_exc: Exception | None = None
    for round_no in range(max_rounds):
        try:
            return provider.complete(system_prompt, user_prompt), provider.name
        except Exception as exc:  # noqa: BLE001 - classified just below; anything unknown is raised
            if not _worth_retrying(exc):
                raise
            logger.warning("provider %s failed (%s)", provider.name, type(exc).__name__)
            last_exc = exc
            if round_no < max_rounds - 1 and retry_delay_s:
                hint = getattr(exc, "retry_after", None) or 0.0
                time.sleep(min(max(retry_delay_s * 2**round_no, hint), 60.0))
    assert last_exc is not None
    raise last_exc


def _citations_as_text(payload: dict) -> None:
    """A model often writes a cited value as a JSON number (0) where the schema wants the text "0". The
    Watchdog compares text with text, so the value is kept exactly as written and only its type is fixed."""
    cited = payload.get("cited_evidence")
    if not isinstance(cited, list):
        return
    for entry in cited:
        if isinstance(entry, dict):
            for key in ("row_id", "field", "value"):
                if isinstance(entry.get(key), int | float | bool):
                    entry[key] = str(entry[key])


def parse_and_validate(
    raw_text: str,
    expected_agent_id: str,
    expected_round: int,
    valid_row_ids: set[str],
) -> AgentResponse:
    payload = _extract_json(raw_text)

    # agent_id and round are bookkeeping the caller already knows, not findings of the model, so they are set
    # from what was asked rather than from what the model echoed. Observed live: a model leaves "round" out,
    # or copies the example "round": 1 of the schema into round 3, and failing the whole debate over that
    # would lose real findings. This touches neither the theory nor the cited evidence.
    if isinstance(payload, dict):
        if payload.get("agent_id") != expected_agent_id or payload.get("round") != expected_round:
            logger.info(
                "%s, round %d: the answer's agent_id/round (%r, %r) were set to the ones asked",
                expected_agent_id,
                expected_round,
                payload.get("agent_id"),
                payload.get("round"),
            )
        payload["agent_id"] = expected_agent_id
        payload["round"] = expected_round
        _citations_as_text(payload)

    try:
        response = AgentResponse.model_validate(payload)
    except ValidationError as exc:
        raise InvalidAgentResponse(f"response failed schema validation: {exc}") from exc

    fabricated = [e.row_id for e in response.cited_evidence if e.row_id not in valid_row_ids]
    if fabricated:
        raise InvalidAgentResponse(
            f"cited row_id(s) not present in this agent's own data slice: {fabricated}"
        )

    return response


_REASK = (
    "\n\nYour previous answer was rejected: {problem}\n"
    "Answer again with ONE JSON object in the required schema. Cite only row_id values that appear in YOUR "
    "data slice above, copied exactly. Rows other agents mention are not yours to cite: argue about their "
    "claims in words."
)
_MAX_PROBLEM_CHARS = 500


def ask(
    provider: LLMProvider,
    system_prompt: str,
    user_prompt: str,
    *,
    agent_id: str,
    round_no: int,
    valid_row_ids: set[str],
) -> tuple[AgentResponse, str]:
    """The model's validated answer, as (response, provider_name). A model that slips once (broken JSON, a
    citation from outside its own data slice) is told what was wrong and asked one more time, because one
    slip should not cost the whole debate; a second slip is raised as InvalidAgentResponse."""
    raw_text, provider_used = call_with_retry(provider, system_prompt, user_prompt)
    try:
        return parse_and_validate(raw_text, agent_id, round_no, valid_row_ids), provider_used
    except InvalidAgentResponse as problem:
        logger.warning("%s, round %d: answer rejected (%s); asking once more", agent_id, round_no, problem)
        note = _REASK.format(problem=str(problem)[:_MAX_PROBLEM_CHARS])
        raw_text, provider_used = call_with_retry(provider, system_prompt, user_prompt + note)
        return parse_and_validate(raw_text, agent_id, round_no, valid_row_ids), provider_used
