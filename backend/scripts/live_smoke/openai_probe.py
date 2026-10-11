"""Is the real OpenAI path ready? One tiny question through the project's own client, then what the key
allows.

Run: python -m backend.scripts.live_smoke.openai_probe        (exit code 0: a debate fits, 1: none does)

The answer is recorded for the pages (Live, Access) exactly as a debate would leave it. A refused question
costs no tokens but counts as one request. The key is never printed.
"""

import sys

from backend.agents import openai_usage
from backend.agents.llm_clients import (
    OpenAIClient,
    OpenAIError,
    OpenAIUnavailable,
    ProviderRateLimited,
    model_name,
)
from backend.debate.engine import ESTIMATED_TOKENS_PER_DEBATE, REQUESTS_PER_DEBATE


def debates_left(reading: openai_usage.Allowance | None) -> int | None:
    """Whole debates the latest reading covers, or None when OpenAI did not say."""
    if reading is None or reading.remaining_requests is None or reading.remaining_tokens is None:
        return None
    return min(
        reading.remaining_requests // REQUESTS_PER_DEBATE,
        reading.remaining_tokens // ESTIMATED_TOKENS_PER_DEBATE,
    )


def ask() -> str:
    """One tiny question; the sentence that says what happened."""
    try:
        OpenAIClient().complete_text("Answer with one word.", "Say ok.")
    except ProviderRateLimited as exc:
        return f"OpenAI refused: {exc.detail or 'a limit was reached, try again in a minute'}"
    except (OpenAIError, OpenAIUnavailable) as exc:
        return f"OpenAI did not answer: {exc}"
    return "OpenAI answered."


def describe(reading: openai_usage.Allowance | None) -> list[str]:
    """What the key allows, one line each, from OpenAI's own x-ratelimit headers."""
    if reading is None:
        return ["OpenAI sent no limit headers, so what the key allows is unknown."]

    def line(name: str, left: int | None, allowed: int | None, reset_s: float | None) -> str:
        if left is None:
            return f"{name} left: OpenAI did not say"
        of = f" of {allowed:,}" if allowed is not None else ""
        back = f" (back to full in {openai_usage.format_wait(reset_s)})" if reset_s else ""
        return f"{name} left: {left:,}{of}{back}"

    fits = debates_left(reading)
    return [
        line("requests", reading.remaining_requests, reading.limit_requests, reading.reset_requests_s),
        line("tokens", reading.remaining_tokens, reading.limit_tokens, reading.reset_tokens_s),
        f"one debate needs about {REQUESTS_PER_DEBATE} requests and {ESTIMATED_TOKENS_PER_DEBATE:,} tokens: "
        + ("OpenAI did not say how many fit" if fits is None else f"{fits} fit now"),
    ]


def main() -> int:
    print(f"OpenAI probe, model {model_name()}")
    print(" ", ask())
    reading = openai_usage.read_limits()
    for text in describe(reading):
        print(" ", text)
    return 0 if debates_left(reading) else 1


if __name__ == "__main__":
    sys.exit(main())
