"""Thin REST clients for the two locked LLM providers (CLAUDE.md tech stack).
Plain HTTP via httpx rather than each provider's SDK — avoids SDK version churn
and keeps both providers behind the same tiny interface (complete() -> str).
"""

from typing import Protocol

import httpx

from backend.config import settings

# CLAUDE.md originally pinned llama3.1:8b for Ollama; that model doesn't exist on
# Groq's hosted catalog at all (confirmed via /v1/models on 2026-09-07 - Groq has
# dropped Meta's Llama chat models entirely). gemini-2.0-flash was decommissioned
# by Google the same year. These are the current replacements - see the Module 3
# summary for why. GEMINI_MODEL uses Google's "-latest" alias deliberately, so a
# future model retirement doesn't silently 404 this again; Groq has no such alias,
# so GROQ_MODEL will need revisiting if/when Groq retires this one too.
GROQ_MODEL = "openai/gpt-oss-20b"
GEMINI_MODEL = "gemini-flash-latest"


class LLMProvider(Protocol):
    name: str

    def complete(self, system_prompt: str, user_prompt: str) -> str: ...


class GroqClient:
    name = "groq"

    def __init__(self, api_key: str | None = None, model: str = GROQ_MODEL, timeout: float = 30.0):
        self.api_key = api_key or settings.groq_api_key
        self.model = model
        self.timeout = timeout

    def complete(self, system_prompt: str, user_prompt: str) -> str:
        response = httpx.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json={
                "model": self.model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": 0.2,
                "response_format": {"type": "json_object"},
            },
            timeout=self.timeout,
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]


class GeminiClient:
    name = "gemini"

    def __init__(self, api_key: str | None = None, model: str = GEMINI_MODEL, timeout: float = 30.0):
        self.api_key = api_key or settings.gemini_api_key
        self.model = model
        self.timeout = timeout

    def complete(self, system_prompt: str, user_prompt: str) -> str:
        response = httpx.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent",
            headers={"x-goog-api-key": self.api_key, "Content-Type": "application/json"},
            json={
                "systemInstruction": {"parts": [{"text": system_prompt}]},
                "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
                "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json"},
            },
            timeout=self.timeout,
        )
        response.raise_for_status()
        return response.json()["candidates"][0]["content"]["parts"][0]["text"]
