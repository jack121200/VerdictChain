"""Manual, real-API proof that the Network-Traffic Agent works end-to-end against
the actual Groq/Gemini services — not part of pytest (see backend/tests/conftest.py
note: this is deliberately kept out of the automated suite so CI stays fast,
deterministic, and free of live network/quota dependencies).

Run: python -m backend.scripts.smoke_test_agent_live
"""

from backend.agents import network_traffic
from backend.pipeline.investigation_builder import create_manual_investigation


def main() -> None:
    investigation, rows = create_manual_investigation("DDoS")
    print(f"Investigation {investigation.investigation_id}: {len(rows)} rows (scenario hidden from agent)")

    response, provider_used = network_traffic.investigate(rows[:3], round_no=1)

    print(f"\nServed by: {provider_used}")
    print(f"agent_id: {response.agent_id}")
    print(f"theory: {response.theory}")
    print(f"confidence: {response.confidence}")
    print(f"cited_evidence ({len(response.cited_evidence)}):")
    for ev in response.cited_evidence:
        print(f"  - row_id={ev.row_id} field={ev.field!r} value={ev.value!r}")


if __name__ == "__main__":
    main()
