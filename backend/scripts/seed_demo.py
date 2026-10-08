"""Seed a target database with complete, realistic investigations WITHOUT any LLM call.

Reuses the offline stub (backend.scripts.e2e_server.install) so the real investigator agents,
debate engine, Watchdog, verdict aggregation, self-healing and audit chain all run against real
raw_logs rows and produce consistent, verifiable data. Zero provider calls, zero quota burn.

It writes to whatever LOCAL_DATABASE_URL / DATABASE_URL resolves to (the dev DB in development),
and updates Redis (REDIS_URL) credibility scores the same way a real debate would. It is additive:
each run creates fresh investigations.

Usage:
  python -m backend.scripts.seed_demo
  python -m backend.scripts.seed_demo --scenarios DDoS Portscan insider_scenario_1 --max-rows 5
"""

import argparse

from backend.debate.engine import DebateFailedError, run_debate, start_investigation
from backend.debate.state import dominant_agent_for_rows
from backend.pipeline.log_streamer import get_rows_for_scenario
from backend.scripts.e2e_server import install, stub_calls, uninstall

DEFAULT_SCENARIOS = [
    "DDoS",
    "Portscan",
    "SSH-Patator",
    "Botnet",
    "insider_scenario_1",
    "insider_scenario_2",
]


def seed_one(label: str, max_rows: int) -> str | None:
    """Runs one full debate for a scenario and returns the investigation id, or None on skip/fail."""
    rows = get_rows_for_scenario(label)
    if not rows:
        print(f"  skip {label}: no rows for this label (is the dataset ingested?)")
        return None

    primary_agent, primary_rows = dominant_agent_for_rows(rows)
    investigation_id = start_investigation(
        trigger_type="manual",
        trigger_reason=f"seed demo: {label}",
        scenario_label=label,
        primary_agent=primary_agent,
        noise_pct=0,
        effective_noise_pct=0.0,
        injected_row_ids=[],
        started_by="seed",
        max_rows_per_agent=max_rows,
    )

    try:
        result = run_debate(
            primary_agent, primary_rows, investigation_id=investigation_id, max_rows_per_agent=max_rows
        )
    except DebateFailedError as exc:
        print(f"  {label}: debate failed ({exc.reason})")
        return None

    verdict = result["verdict"]
    print(
        f"  {label}: {str(investigation_id)[:8]} -> {verdict['verdict_class']} "
        f"(confidence {verdict['verdict_confidence']}, {len(result['actions_taken'])} action(s))"
    )
    return str(investigation_id)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Seed complete demo investigations with no LLM call.")
    parser.add_argument("--scenarios", nargs="*", default=DEFAULT_SCENARIOS, help="scenario labels to seed")
    parser.add_argument("--max-rows", type=int, default=5, help="rows per agent per debate")
    args = parser.parse_args(argv)

    install()  # deterministic offline agents; no Groq/Gemini calls
    created: list[str] = []
    try:
        print(f"Seeding {len(args.scenarios)} investigation(s) with the offline stub (no provider calls):")
        for label in args.scenarios:
            investigation_id = seed_one(label, args.max_rows)
            if investigation_id is not None:
                created.append(investigation_id)
    finally:
        served = sum(stub_calls().values())
        uninstall()

    print(f"Done: {len(created)} investigation(s) created. Stub replies: {served}; real provider calls: 0.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
