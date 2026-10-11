"""ST6: the three investigators are listed once (backend/agents/registry.py). The table matches the places
that must spell the ids as fixed text, and no other file keeps a copy."""

import re
from pathlib import Path
from typing import get_args

from backend.agents import access_log, endpoint_behavior, network_traffic, registry
from backend.agents.schemas import AgentId
from backend.db.models import AgentQuarantine
from backend.debate.engine import INVESTIGATORS

BACKEND_DIR = Path(__file__).resolve().parents[2]
# Files that may spell an investigator id as a quoted string: the table, the type, the agents themselves, the
# database (a check constraint and the migrations are frozen text) and the offline test stub.
ALLOWED = {
    "agents/registry.py",
    "agents/schemas.py",
    "agents/network_traffic.py",
    "agents/access_log.py",
    "agents/endpoint_behavior.py",
    "db/models.py",
    "testing/e2e_server.py",
}
ID_AS_STRING = re.compile(r"""["'](?:network_traffic|access_log|endpoint_behavior)["']""")


def test_the_table_lists_the_ids_of_the_agent_type_in_display_order():
    assert registry.INVESTIGATOR_IDS == get_args(AgentId)
    assert list(registry.PROFILES) == list(registry.INVESTIGATOR_IDS)
    assert all(profile.agent_id == agent_id for agent_id, profile in registry.PROFILES.items())


def test_every_agent_reads_something_and_no_source_or_event_type_has_two_owners():
    sources = [source for p in registry.PROFILES.values() for source in p.sources]
    events = [event for p in registry.PROFILES.values() for event in p.event_types]
    profiles = registry.PROFILES.values()
    assert all(p.sources and p.event_types and p.display_name and p.domain for p in profiles)
    assert len(sources) == len(set(sources)) and len(events) == len(set(events))
    assert registry.DOMAIN_SOURCES == {i: list(p.sources) for i, p in registry.PROFILES.items()}
    assert set(registry.EVENT_TYPE_TO_AGENT.values()) == set(registry.INVESTIGATOR_IDS)


def test_the_datasets_are_the_two_the_project_ingests():
    assert registry.DATASET_BY_AGENT == {
        "network_traffic": "CICIDS2017",
        "access_log": "CERT r4.2",
        "endpoint_behavior": "CERT r4.2",
    }


def test_the_agent_modules_the_engine_and_the_database_agree_with_the_table():
    modules = (network_traffic, access_log, endpoint_behavior)
    assert [module.AGENT_ID for module in modules] == list(registry.INVESTIGATOR_IDS)
    assert tuple(INVESTIGATORS) == registry.INVESTIGATOR_IDS
    check = next(c for c in AgentQuarantine.__table__.constraints if c.name == "ck_agent_quarantine_agent_id")
    assert set(re.findall(r"'([a-z_]+)'", str(check.sqltext))) == set(registry.INVESTIGATOR_IDS)


def test_no_other_file_keeps_a_copy_of_the_ids():
    copies = []
    for path in sorted(BACKEND_DIR.rglob("*.py")):
        relative = path.relative_to(BACKEND_DIR).as_posix()
        if relative.startswith(("tests/", "db/migrations/")) or relative in ALLOWED:
            continue
        if ID_AS_STRING.search(path.read_text(encoding="utf-8")):
            copies.append(relative)
    assert copies == [], f"read the ids from backend/agents/registry.py instead: {copies}"
