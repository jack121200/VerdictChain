"""Real-API proof for the full 3-agent, 3-round debate engine. Deliberately
outside pytest (9 real LLM calls - slow, uses quota, non-deterministic).

Run: python -m backend.scripts.smoke_test_debate_live
"""

from backend.debate.engine import run_debate, start_investigation
from backend.debate.state import dominant_agent_for_rows
from backend.pipeline.log_streamer import get_rows_for_scenario


def main() -> None:
    rows = get_rows_for_scenario("DDoS")
    if not rows:
        raise SystemExit("no DDoS rows ingested - run the ingestion step first")
    primary_agent, primary_rows = dominant_agent_for_rows(rows)
    print(f"Primary investigation: {len(rows)} DDoS rows (scenario hidden from every agent)")

    investigation_id = start_investigation(
        trigger_type="manual",
        trigger_reason="live smoke test",
        scenario_label="DDoS",
        primary_agent=primary_agent,
        noise_pct=0,
        effective_noise_pct=0.0,
        injected_row_ids=[row.row_id for row in rows],
        started_by="smoke_test",
        max_rows_per_agent=5,
    )
    result = run_debate(
        primary_agent, primary_rows[:5], investigation_id=investigation_id, scenario_rows=rows
    )

    print(f"\ninvestigation_id: {result['investigation_id']}")
    print(f"status: {result['status']}")
    print(f"providers_used: {result['providers_used']}")
    print(f"\nverdict: {result['verdict']}")


if __name__ == "__main__":
    main()
