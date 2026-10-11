"""What went wrong when a debate could not finish, in words an analyst can act on (checklist BE4).

The provider clients raise their own exceptions: a 429 that says the daily quota is spent, a plain HTTP
error, an answer that failed validation. This module reads them by shape (class name, attributes, the HTTP
status), not by importing the client module, so it keeps working whichever client version is installed.
"""

from dataclasses import dataclass
from typing import Literal

import httpx

FailureKind = Literal["daily_quota", "rate_limited", "invalid_answer", "other"]

_HOSTS = {"api.openai.com": "openai"}
_MAX_DETAIL = 300


@dataclass(frozen=True)
class Failure:
    kind: FailureKind
    provider: str | None  # openai when it can be told
    message: str  # for the analyst: what happened and what to do


def classify(exc: BaseException) -> Failure:
    name = type(exc).__name__
    text = str(exc)
    if name == "ProviderRateLimited":
        provider = text.split(" ", 1)[0] or None  # the client writes "<provider> returned 429 (...)"
        return _rate_limit(
            provider, daily=bool(getattr(exc, "daily", False)), detail=getattr(exc, "detail", None)
        )
    if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code in (429, 503):
        return _rate_limit(_HOSTS.get(exc.request.url.host), daily="PerDay" in exc.response.text)
    if name == "InvalidAgentResponse":
        return Failure(
            "invalid_answer",
            None,
            f"An investigator returned an answer that failed validation: {text[:_MAX_DETAIL]}",
        )
    return Failure("other", None, text[:_MAX_DETAIL] or name)


def _rate_limit(provider: str | None, *, daily: bool, detail: str | None = None) -> Failure:
    who = provider or "model provider"
    if daily and detail:
        return Failure("daily_quota", provider, detail)  # the client already wrote the exact sentence
    if daily:
        return Failure(
            "daily_quota",
            provider,
            f"The {who} account has no quota or credit left. "
            "Add credit in the OpenAI account, then try again.",
        )
    return Failure("rate_limited", provider, f"The {who} is rate limiting requests. Try again in a minute.")


def explain_failure(exc: BaseException) -> str:
    return classify(exc).message
