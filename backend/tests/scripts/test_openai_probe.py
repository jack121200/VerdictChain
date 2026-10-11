"""The real-key probe (backend/scripts/live_smoke/openai_probe.py): what it says about the key's allowance,
and that it never prints the key. No test reaches OpenAI: the HTTP call is replaced."""

import httpx
import pytest

from backend.agents import llm_clients, openai_usage
from backend.agents.openai_usage import Allowance
from backend.config import settings
from backend.debate.engine import ESTIMATED_TOKENS_PER_DEBATE, REQUESTS_PER_DEBATE
from backend.scripts.live_smoke import openai_probe

SECRET = "sk-probe-secret-0123456789"


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", SECRET)
    monkeypatch.setattr(llm_clients, "_throttle", lambda: None)
    monkeypatch.setattr(llm_clients, "_exhausted_until", 0.0)
    openai_usage.reset()
    yield
    openai_usage.reset()


def _reading(requests: int | None = 14, tokens: int | None = 0) -> Allowance:
    return Allowance(
        limit_requests=50,
        remaining_requests=requests,
        limit_tokens=100_000,
        remaining_tokens=tokens,
        reset_requests_s=60_939.0,
        reset_tokens_s=2_627_043.84,
        blocked_until=None,
        at=1_800_000_000.0,
    )


def _answer(monkeypatch, status: int, body: dict, headers: dict | None = None) -> None:
    def post(url, **kwargs):
        return httpx.Response(status, json=body, headers=headers or {}, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", post)


def test_a_spent_token_allowance_fits_no_debate_and_the_lines_say_so():
    reading = _reading(requests=14, tokens=0)

    assert openai_probe.debates_left(reading) == 0
    assert openai_probe.describe(reading) == [
        "requests left: 14 of 50 (back to full in 16 hours 56 minutes)",
        "tokens left: 0 of 100,000 (back to full in 30 days)",
        f"one debate needs about {REQUESTS_PER_DEBATE} requests and {ESTIMATED_TOKENS_PER_DEBATE:,} tokens: "
        "0 fit now",
    ]


def test_the_scarcer_of_requests_and_tokens_sets_how_many_debates_fit():
    assert openai_probe.debates_left(_reading(requests=50, tokens=100_000)) == 3  # tokens: 3, requests: 5
    assert openai_probe.debates_left(_reading(requests=20, tokens=1_000_000)) == 2  # requests: 2, tokens: 33


def test_what_openai_did_not_say_is_said_not_guessed():
    assert openai_probe.debates_left(None) is None
    assert openai_probe.debates_left(_reading(tokens=None)) is None
    assert openai_probe.describe(None) == ["OpenAI sent no limit headers, so what the key allows is unknown."]
    lines = openai_probe.describe(_reading(requests=None, tokens=None))
    assert lines[0] == "requests left: OpenAI did not say" and lines[1] == "tokens left: OpenAI did not say"
    assert lines[2].endswith("OpenAI did not say how many fit")


def test_a_refused_question_is_reported_in_words_and_leaves_the_reading_for_the_pages(monkeypatch):
    refusal = {
        "error": {
            "message": (
                "Rate limit reached for gpt-6-luna in organization org-SECRETORG on tokens per min (TPM): "
                "Limit 100000, Used 100000, Requested 17. Please try again in 7m20.64s."
            ),
            "type": "tokens",
            "code": "rate_limit_exceeded",
        }
    }
    headers = {
        "retry-after": "441",
        "x-ratelimit-limit-requests": "50",
        "x-ratelimit-remaining-requests": "14",
        "x-ratelimit-limit-tokens": "100000",
        "x-ratelimit-remaining-tokens": "0",
        "x-ratelimit-reset-tokens": "729h44m3.84s",
    }
    _answer(monkeypatch, 429, refusal, headers)

    sentence = openai_probe.ask()

    assert sentence.startswith(
        "OpenAI refused: OpenAI's token allowance for this key (100,000 tokens) is used up"
    )
    assert "org-SECRETORG" not in sentence and SECRET not in sentence
    assert openai_usage.read_limits().remaining_tokens == 0  # the Live and Access pages show it from here


def test_a_rejected_key_is_reported_without_the_key(monkeypatch):
    _answer(monkeypatch, 401, {"error": {"message": f"Incorrect API key provided: {SECRET}"}})

    sentence = openai_probe.ask()

    assert sentence == (
        "OpenAI did not answer: OpenAI rejected the API key (HTTP 401). Put a valid OPENAI_API_KEY in .env."
    )
    assert SECRET not in sentence


def test_an_answered_question_says_so(monkeypatch):
    body = {
        "choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 12, "completion_tokens": 1},
    }
    _answer(monkeypatch, 200, body, {"x-ratelimit-remaining-requests": "13"})

    assert openai_probe.ask() == "OpenAI answered."


@pytest.mark.parametrize(
    ("reading", "code", "fits"),
    [(_reading(50, 100_000), 0, "3 fit now"), (_reading(), 1, "0 fit now")],
)
def test_the_exit_code_says_whether_a_debate_fits(monkeypatch, capsys, reading, code, fits):
    monkeypatch.setattr(openai_probe, "ask", lambda: "OpenAI answered.")
    monkeypatch.setattr(openai_usage, "read_limits", lambda: reading)

    assert openai_probe.main() == code

    output = capsys.readouterr().out
    assert fits in output and SECRET not in output and output.startswith("OpenAI probe, model ")
