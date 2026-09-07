"""Loads CERT r4.2 ground truth from answers.tar.bz2 (already extracted at
data/raw_data/insider_raw_data/answers_extracted/answers/ - r4.2-1/2/3 + insiders.csv).

r4.2 has 3 insider scenarios (not the 5 the user misremembered - using the real
numbers, per their "jitna sahi lage" go-ahead): 30 + 30 + 10 = 70 malicious users,
each with an exact set of malicious event ids (matching logon.csv/device.csv/
file.csv id columns) from their own per-user detail CSV.
"""

import csv
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
ANSWERS_DIR = REPO_ROOT / "data" / "raw_data" / "insider_raw_data" / "answers_extracted" / "answers"

SCENARIOS = (1, 2, 3)


def load_malicious_event_ids() -> dict[str, str]:
    """Returns {event_id: scenario_label}, e.g. {'{X1D9-...}': 'insider_scenario_1'}."""
    event_to_scenario: dict[str, str] = {}
    for scenario in SCENARIOS:
        scenario_dir = ANSWERS_DIR / f"r4.2-{scenario}"
        label = f"insider_scenario_{scenario}"
        for detail_csv in scenario_dir.glob(f"r4.2-{scenario}-*.csv"):
            with open(detail_csv, newline="", encoding="utf-8") as f:
                for row in csv.reader(f):
                    if not row:
                        continue
                    event_id = row[1]  # activity_type,event_id,date,user,pc,...
                    event_to_scenario[event_id] = label
    return event_to_scenario


def load_malicious_users() -> dict[str, str]:
    """Returns {user_id: scenario_label} for all 70 r4.2 malicious users."""
    users: dict[str, str] = {}
    with open(ANSWERS_DIR / "insiders.csv", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row["dataset"] == "4.2":
                users[row["user"]] = f"insider_scenario_{row['scenario']}"
    return users
