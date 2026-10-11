"""The one LLM provider of the project: OpenAI (owner's decision of 2026-10-11; Groq and Gemini are gone).

Plain HTTP via httpx rather than the SDK, behind a tiny interface: complete() -> JSON text for the
investigators, complete_text() -> one short sentence for the reason written with a containment action.
The model is OPENAI_MODEL in .env; the key is OPENAI_API_KEY in .env and never appears in a message, a log
line or an exception: errors are written in words from the status code alone.

Spend is bounded in code, not by hope: every call is checked against a rolling 24 hour token budget
(openai_usage.py, OPENAI_DAILY_TOKEN_LIMIT) before any request leaves the machine, and each call's
tokens, as the API reports them, are counted afterwards.
"""

import logging
import re
import threading
import time
from typing import Protocol

import httpx
import redis

from backend.agents import openai_usage
from backend.config import settings

logger = logging.getLogger(__name__)

OPENAI_URL = "https://api.openai.com/v1/chat/completions"
DEFAULT_MODEL = "gpt-4.1-mini"  # used when OPENAI_MODEL is empty
TEMPERATURE = 0.2
_REASONING_PREFIXES = ("o1", "o3", "o4", "gpt-5")  # these models accept only their default temperature

# Minimum gap between two requests, so the three investigators of a round do not start in the same instant.
MIN_INTERVAL_S = 0.3
_throttle_lock = threading.Lock()
_last_call_at = 0.0

# A spent account (insufficient_quota) will not recover by waiting seconds, but credit can be added at any
# minute: skip the API for this long only, so the first call after a top-up goes through.
DAILY_QUOTA_COOLDOWN_S = 60.0
_exhausted_until = 0.0

# A 429 that asks for a wait longer than this is a limit that frees up slowly (a daily one), not a burst.
LONG_WAIT_S = 60.0
# A tokens limit whose bucket takes longer than this to reset is not a per-minute burst limit: it is an
# allowance that is spent (this project's key: 100 000 tokens, resetting in about 30 days). OpenAI's
# retry-after on such an answer says minutes, but the next try fails the same way, so the reset time rules.
ALLOWANCE_SPENT_S = openai_usage.SPENT_ALLOWANCE_S
_LIMIT_RE = re.compile(r"on ([a-z ]+?) \((RPM|RPD|TPM|TPD)\): Limit (\d+)")

# A cut-off answer is asked for again with double the room, at most twice and never above this many tokens.
MAX_CUT_OFF_RETRIES = 2
MAX_RETRY_OUTPUT_TOKENS = 16000

# Parameters a model refused once (a newer model may take no custom temperature): not sent again.
_refused: dict[str, set[str]] = {}


class ProviderRateLimited(Exception):
    """429/503 from the provider. retry_after is its own hint, in seconds; daily=True means the key's quota,
    credit or a limit that frees up slowly (requests per day) is spent, so short retries are pointless."""

    def __init__(
        self,
        provider: str,
        status: int,
        retry_after: float | None,
        daily: bool = False,
        detail: str | None = None,
    ):
        super().__init__(f"{provider} returned {status} (retry-after={retry_after}, daily_quota={daily})")
        self.retry_after = retry_after
        self.daily = daily
        self.detail = detail  # a sentence for the analyst when the plain wording would not say enough


class OpenAIError(Exception):
    """A problem that waiting will not fix (bad key, unknown model, empty answer). The text is for the
    analyst."""


class OpenAIUnavailable(Exception):
    """OpenAI did not answer in time or answered with a server error. Worth retrying."""


class _CutOff(Exception):
    """The answer stopped at the token limit (finish reason 'length'). Handled inside the client."""


class LLMProvider(Protocol):
    name: str

    def complete(self, system_prompt: str, user_prompt: str) -> str: ...


def model_name() -> str:
    return settings.openai_model.strip() or DEFAULT_MODEL


def is_reasoning_model(model: str) -> bool:
    return model.lower().startswith(_REASONING_PREFIXES)


def _throttle() -> None:
    global _last_call_at
    with _throttle_lock:
        wait = _last_call_at + MIN_INTERVAL_S - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last_call_at = time.monotonic()


def _limit_sentence(message: str | None, wait_s: float) -> str:
    """The sentence for a 429 that asks for a long wait. OpenAI's own message names the limit that was hit
    (and the organisation, which is left out here)."""
    wait = openai_usage.format_wait(wait_s)
    match = _LIMIT_RE.search(message or "")
    if match is None:
        return f"OpenAI's rate limit for this key is reached. It frees up in about {wait}."
    kind, code, allowed = match.groups()
    return (
        f"OpenAI's limit on {kind} ({code}) for this key is reached: {int(allowed):,} allowed. "
        f"It frees up in about {wait}."
    )


def _allowance_sentence(response: httpx.Response, wait_s: float) -> str:
    """The sentence for a spent token allowance (see ALLOWANCE_SPENT_S)."""
    try:
        limit = int(response.headers["x-ratelimit-limit-tokens"])
        amount = f" ({limit:,} tokens)"
    except (KeyError, ValueError):
        amount = ""
    wait = openai_usage.format_wait(wait_s)
    return (
        f"OpenAI's token allowance for this key{amount} is used up. It frees up in about {wait}; "
        "OpenAI says adding a payment method to the account raises the limit."
    )


def _error_field(response: httpx.Response, name: str) -> str | None:
    try:
        error = response.json().get("error") or {}
    except ValueError:
        return None
    value = error.get(name)
    return value if isinstance(value, str) else None


def _out_of_credit(response: httpx.Response) -> bool:
    """An account with no credit answers 429 with type "insufficient_quota" and, observed live, code
    "credit_balance_exhausted"; older answers carry insufficient_quota in the code."""
    kind, code = _error_field(response, "type"), _error_field(response, "code")
    return "insufficient_quota" in (kind, code) or code == "credit_balance_exhausted"


class OpenAIClient:
    name = "openai"

    def __init__(
        self,
        api_key: str | None = None,
        model: str | None = None,
        timeout: float = 90.0,
        max_output_tokens: int | None = None,
    ) -> None:
        self.api_key = api_key if api_key is not None else settings.openai_api_key
        self.model = model or model_name()
        self.timeout = timeout
        self.max_output_tokens = max_output_tokens or settings.openai_max_output_tokens

    def complete(self, system_prompt: str, user_prompt: str) -> str:
        """A JSON answer (the investigators)."""
        return self._call(
            system_prompt, user_prompt, json_mode=True, max_output_tokens=self.max_output_tokens
        )

    def complete_text(self, system_prompt: str, user_prompt: str, max_output_tokens: int = 200) -> str:
        """A short plain-text answer (the one-sentence reason written for a containment action)."""
        return self._call(system_prompt, user_prompt, json_mode=False, max_output_tokens=max_output_tokens)

    def _payload(self, system_prompt: str, user_prompt: str, json_mode: bool, max_output_tokens: int) -> dict:
        refused = _refused.get(self.model, set())
        payload: dict = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "max_completion_tokens": max_output_tokens,
        }
        if json_mode and "response_format" not in refused:
            payload["response_format"] = {"type": "json_object"}
        if "temperature" not in refused and not is_reasoning_model(self.model):
            payload.update({"temperature": 0.2})  # the literal the fleet page reports (routes/agents.py)
        return payload

    def _call(self, system_prompt: str, user_prompt: str, *, json_mode: bool, max_output_tokens: int) -> str:
        if not self.api_key.strip():
            raise OpenAIError("OPENAI_API_KEY is not set in .env, so no model can be asked.")
        blocked = openai_usage.allowance_block()
        if blocked is not None or _exhausted_until > time.monotonic():
            raise ProviderRateLimited(self.name, 429, None, daily=True, detail=blocked)
        tokens = max_output_tokens
        cut_offs = 0
        while True:  # ends: a refused parameter is never sent again (there are two), and cut-offs are counted
            openai_usage.check_budget()
            _throttle()
            payload = self._payload(system_prompt, user_prompt, json_mode, tokens)
            try:
                response = httpx.post(
                    OPENAI_URL,
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    json=payload,
                    timeout=self.timeout,
                )
            except httpx.HTTPError as exc:  # timeouts and connection errors; their text can carry the URL
                raise OpenAIUnavailable(f"OpenAI did not answer ({type(exc).__name__}).") from None
            openai_usage.record_limits(response.headers)
            param = self._refused_parameter(response)
            # The investigators of a round are asked at the same time, so a refusal can arrive for a
            # parameter another call has already learned to leave out. Only one this request sent counts.
            if param is not None and param in payload:
                _refused.setdefault(self.model, set()).add(param)
                logger.info("model %s takes no %s: not sent again", self.model, param)
                continue
            try:
                return self._read(response, system_prompt, user_prompt, json_mode)
            except _CutOff:
                # The answer hit the token limit: a thinking model may have spent it all on thinking, and a
                # JSON answer cut in the middle is no answer. Ask again with room for twice as much, twice.
                if cut_offs >= MAX_CUT_OFF_RETRIES or tokens >= MAX_RETRY_OUTPUT_TOKENS:
                    raise OpenAIError(
                        f"OpenAI cut the answer off at {tokens} tokens. Raise OPENAI_MAX_OUTPUT_TOKENS."
                    ) from None
                cut_offs += 1
                tokens = min(tokens * 2, MAX_RETRY_OUTPUT_TOKENS)
                logger.info("answer cut off at the token limit: asking again with room for %d tokens", tokens)

    @staticmethod
    def _refused_parameter(response: httpx.Response) -> str | None:
        """'temperature' or 'response_format' when the model said it does not take that parameter."""
        if response.status_code != 400:
            return None
        param = _error_field(response, "param")
        code = _error_field(response, "code")
        if param in ("temperature", "response_format") and code in (
            "unsupported_value",
            "unsupported_parameter",
        ):
            return param
        return None

    def _read(self, response: httpx.Response, system_prompt: str, user_prompt: str, json_mode: bool) -> str:
        global _exhausted_until
        status = response.status_code
        if status in (401, 403):
            raise OpenAIError(
                f"OpenAI rejected the API key (HTTP {status}). Put a valid OPENAI_API_KEY in .env."
            )
        if status == 404:
            raise OpenAIError(f"OpenAI has no model '{self.model}' for this key. Set OPENAI_MODEL in .env.")
        if status == 429:
            header = response.headers.get("retry-after")
            try:
                retry_after = float(header) if header else None
            except ValueError:
                retry_after = None
            wait, allowance_spent = retry_after, False
            if _error_field(response, "type") == "tokens":
                reset = openai_usage.parse_duration(response.headers.get("x-ratelimit-reset-tokens"))
                if reset is not None and reset > ALLOWANCE_SPENT_S:
                    wait, allowance_spent = reset, True
            spent = _out_of_credit(response)
            held = wait is not None and wait > LONG_WAIT_S
            detail = None
            if spent:
                _exhausted_until = time.monotonic() + DAILY_QUOTA_COOLDOWN_S
            elif held:
                # A spent allowance is believed for RECHECK_S only: adding credit lifts it at once.
                _exhausted_until = time.monotonic() + (
                    openai_usage.RECHECK_S if wait > ALLOWANCE_SPENT_S else wait
                )
                detail = (
                    _allowance_sentence(response, wait)
                    if allowance_spent
                    else _limit_sentence(_error_field(response, "message"), wait)
                )
                openai_usage.record_limits(response.headers, blocked_for_s=wait)
            raise ProviderRateLimited(self.name, 429, retry_after, daily=spent or held, detail=detail)
        if status >= 500:
            raise OpenAIUnavailable(f"OpenAI answered with a server error (HTTP {status}).")
        if status >= 400:
            raise OpenAIError(
                f"OpenAI refused the request (HTTP {status}, {_error_field(response, 'code') or 'no code'})."
            )

        data = response.json()
        choice = data["choices"][0]
        content = (choice.get("message") or {}).get("content") or ""
        usage = data.get("usage") or {}
        prompt_tokens = usage.get("prompt_tokens")
        completion_tokens = usage.get("completion_tokens")
        if not isinstance(prompt_tokens, int) or not isinstance(completion_tokens, int):
            prompt_tokens = openai_usage.estimate_tokens(system_prompt, user_prompt)
            completion_tokens = openai_usage.estimate_tokens(content)
        try:
            openai_usage.record(prompt_tokens, completion_tokens)
        except (
            redis.RedisError
        ):  # the tokens are spent; the next call's budget check stops if Redis stays down
            logger.warning("could not record OpenAI token usage")
        finish_reason = choice.get("finish_reason")
        if finish_reason == "length" and (json_mode or not content.strip()):
            raise _CutOff
        if not content.strip():
            raise OpenAIError(
                f"OpenAI returned an empty answer (finish reason '{finish_reason}'). "
                "If the model thinks before it answers, raise OPENAI_MAX_OUTPUT_TOKENS."
            )
        return content
