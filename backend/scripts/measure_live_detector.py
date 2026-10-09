"""Measures the live monitor's rule on the ingested datasets (checklist RT2).

  python -m backend.scripts.measure_live_detector [--trials 300] [--seed 1]

For each source group it scores random windows of ordinary rows (how often does the rule flag nothing but
ordinary traffic) and windows cut from the scenarios the way the sensor cuts its segments (how often does it
flag a scenario). It reads the dataset labels, as /evaluation does, because it is a measurement tool: the
monitor itself never does. Nothing is written. Run it on the database that holds the datasets.
"""

import argparse
import random
from collections import defaultdict

from sqlalchemy import select

from backend.db.models import RawLog
from backend.db.session import SessionLocal
from backend.pipeline.live_detector import GROUP_OF_SOURCE, GROUPS, WINDOW_SIZE, row_feature, score_window
from backend.pipeline.live_feed import ATTACK_SEGMENT
from backend.pipeline.live_monitor import compute_baselines


def _load() -> tuple[dict[str, list[float | None]], dict[str, list[tuple[str, float | None]]]]:
    """ordinary[group] = feature of every ordinary row; scenario[label] = (group, feature) oldest first."""
    ordinary: dict[str, list[float | None]] = defaultdict(list)
    scenario: dict[str, list[tuple[str, float | None]]] = defaultdict(list)
    with SessionLocal() as session:
        for source, group in GROUP_OF_SOURCE.items():
            rows = session.execute(
                select(RawLog.ground_truth_label, RawLog.raw_fields)
                .where(RawLog.source == source)
                .order_by(RawLog.timestamp, RawLog.row_id)
            ).all()
            for label, raw_fields in rows:
                feature = row_feature(group, raw_fields)
                if label is None or label.lower() == "benign":
                    ordinary[group].append(feature)
                else:
                    scenario[label].append((group, feature))
    return ordinary, scenario


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--trials", type=int, default=300)
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()
    rng = random.Random(args.seed)
    baselines = compute_baselines()
    ordinary, scenario = _load()

    print(f"trials per line: {args.trials}   seed: {args.seed}")
    print("\nordinary windows (a flag here is a false alarm)")
    for group in GROUPS:
        rows, size = ordinary.get(group, []), WINDOW_SIZE[group]
        if len(rows) < size:
            print(f"  {group:8s} not enough ordinary rows ({len(rows)})")
            continue
        flagged = sum(
            score_window(group, rng.sample(rows, size), baselines.get(group)).flagged
            for _ in range(args.trials)
        )
        print(f"  {group:8s} {flagged:4d} / {args.trials} flagged  ({flagged / args.trials:.1%})")

    print("\nscenario windows, cut like the sensor's segments (a flag here is a detection)")
    for label in sorted(scenario):
        rows = scenario[label]
        by_group: dict[str, list[bool]] = defaultdict(list)
        for _ in range(args.trials):
            length = min(len(rows), rng.randint(*ATTACK_SEGMENT))
            start = rng.randrange(0, len(rows) - length + 1)
            for group in GROUPS:
                features = [feature for g, feature in rows[start : start + length] if g == group]
                size = WINDOW_SIZE[group]
                if len(features) >= size:
                    by_group[group].append(
                        score_window(group, features[-size:], baselines.get(group)).flagged
                    )
        for group, results in sorted(by_group.items()):
            share = f"{sum(results) / len(results):.1%}"
            print(
                f"  {label:20s} {group:8s} {sum(results):4d} / {len(results):4d} flagged  "
                f"({share} of the segments that fill a {WINDOW_SIZE[group]}-row window)"
            )


if __name__ == "__main__":
    main()
