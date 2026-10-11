"""The one table of the three investigators: id, display name, data domain, dataset, and the raw_logs sources
and event types each one reads (SKILL-architecture.md Sections 2 and 3).

Everything that needs one of these facts reads it here; tests/agents/test_registry.py fails on a second copy.
Four places still spell the ids as fixed text and are checked against this table instead of importing it: the
AgentId type (schemas.py), each agent's own AGENT_ID and prompt, the database check constraint (migration
0006) and the offline test stub.
"""

from dataclasses import dataclass

CICIDS = "CICIDS2017"
CERT = "CERT r4.2"


@dataclass(frozen=True)
class InvestigatorProfile:
    agent_id: str
    display_name: str
    domain: str  # the data the agent reads, in words
    dataset: str
    sources: tuple[str, ...]  # raw_logs.source values of that data
    event_types: tuple[str, ...]  # raw_logs.event_type values that belong to the agent


PROFILES: dict[str, InvestigatorProfile] = {
    profile.agent_id: profile
    for profile in (
        InvestigatorProfile(
            agent_id="network_traffic",
            display_name="Network-Traffic Investigator",
            domain="External network traffic (CICIDS2017 flows)",
            dataset=CICIDS,
            sources=("cicids2017",),
            event_types=("network_flow",),
        ),
        InvestigatorProfile(
            agent_id="access_log",
            display_name="Access-Log Investigator",
            domain="File access (CERT r4.2 file.csv)",
            dataset=CERT,
            sources=("cert_r4.2_file",),
            event_types=("file_access",),
        ),
        InvestigatorProfile(
            agent_id="endpoint_behavior",
            display_name="Endpoint-Behavior Investigator",
            domain="Logon and device activity (CERT r4.2 logon.csv, device.csv)",
            dataset=CERT,
            sources=("cert_r4.2_logon", "cert_r4.2_device"),
            event_types=("logon", "device_event"),
        ),
    )
}

# The display order, which is also the order that breaks a tie between agents (plan section 3.3).
INVESTIGATOR_IDS: tuple[str, ...] = tuple(PROFILES)
DOMAIN_SOURCES: dict[str, list[str]] = {agent_id: list(p.sources) for agent_id, p in PROFILES.items()}
DATASET_BY_AGENT: dict[str, str] = {agent_id: p.dataset for agent_id, p in PROFILES.items()}
EVENT_TYPE_TO_AGENT: dict[str, str] = {
    event_type: p.agent_id for p in PROFILES.values() for event_type in p.event_types
}
