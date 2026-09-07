"""Real-API proof for the full 3-agent, 3-round debate engine. Deliberately
outside pytest (9 real LLM calls - slow, uses quota, non-deterministic).

Run: python -m backend.scripts.smoke_test_debate_live
"""

from backend.debate.engine import run_debate
from backend.pipeline.investigation_builder import create_manual_investigation


def main() -> None:
    investigation, rows = create_manual_investigation("DDoS")
    print(f"Primary investigation: {len(rows)} DDoS rows (scenario hidden from every agent)")

    result = run_debate("network_traffic", rows[:5], trigger_reason="live smoke test: DDoS")

    print(f"\ninvestigation_id: {result['investigation_id']}")
    print(f"providers_used: {result['providers_used']}")
    print(f"\nverdict: {result['verdict']}")


if __name__ == "__main__":
    main()
