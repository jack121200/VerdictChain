"""The documents say what the code does (checklist ST10). Only facts a machine can check are checked here:

* every migration a document names exists, and the newest one is named;
* the capability table of SKILL-security.md is the matrix in backend/api/rbac.py;
* every audit action of the code is named in some document;
* .env.example and the Settings class name the same environment variables;
* every `METHOD /path` a document names is a route of the API;
* the claims the project refuses to make (the plan's blacklist) appear only where they are denied.

A document that drifts from the code fails here, with the line to fix.
"""

import re
from pathlib import Path

from backend.api.main import app
from backend.api.rbac import CAPABILITIES
from backend.config import Settings
from backend.db.audit import AUDIT_ACTIONS

ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS = ROOT / "backend" / "db" / "migrations" / "versions"
SKILLS = sorted((ROOT / ".claude" / "skills").glob("*.md"))
SPECS = [ROOT / "README.md", ROOT / "CLAUDE.md", *SKILLS]
DOCS = [*SPECS, ROOT / "docs" / "PROJECT_GUIDE.md", ROOT / "docs" / "CLAIMS_AUDIT.md"]


def _text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _revisions() -> list[str]:
    return sorted(path.name.split("_", 1)[0] for path in MIGRATIONS.glob("0*.py"))


# ---- migrations ---------------------------------------------------------------------------------------


def test_every_migration_a_document_names_exists():
    known = set(_revisions())
    wrong = []
    for path in DOCS:
        for number, line in enumerate(_text(path).splitlines(), 1):
            for match in re.finditer(r"[Mm]igrations? (\d{4})\b", line):
                if match.group(1) not in known:
                    wrong.append(f"{path.relative_to(ROOT).as_posix()}:{number}: migration {match.group(1)}")
    assert wrong == []


def test_the_newest_migration_is_named_in_the_schema_spec():
    head = _revisions()[-1]
    assert head in _text(
        ROOT / ".claude" / "skills" / "SKILL-data-schema.md"
    ), f"SKILL-data-schema.md does not mention the newest migration {head}"


# ---- the capability matrix ----------------------------------------------------------------------------


def test_the_capability_table_in_the_security_spec_is_the_matrix_in_the_code():
    table: dict[str, set[str]] = {}
    for line in _text(ROOT / ".claude" / "skills" / "SKILL-security.md").splitlines():
        match = re.match(r"\s*\|\s*`([a-z_]+)`\s*\|\s*([a-z_, ]+?)\s*\|\s*$", line)
        if match:
            table[match.group(1)] = {role.strip() for role in match.group(2).split(",")}
    assert table == {capability: set(roles) for capability, roles in CAPABILITIES.items()}


# ---- the audit actions --------------------------------------------------------------------------------


def test_every_audit_action_is_named_in_a_document():
    corpus = "\n".join(_text(path) for path in DOCS)
    assert sorted(action for action in AUDIT_ACTIONS if action not in corpus) == []


# ---- the environment ----------------------------------------------------------------------------------

# Keys .env.example carries for the containers and the frontend build, not for the Settings class.
INFRASTRUCTURE_KEYS = {
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "POSTGRES_DB",  # the Postgres container
    "RABBITMQ_USER",
    "RABBITMQ_PASSWORD",  # the RabbitMQ container
    "VITE_API_BASE",  # compiled into the frontend image
}


def _example_keys() -> set[str]:
    text = _text(ROOT / ".env.example")
    return {match.group(1) for match in re.finditer(r"^#?\s*([A-Z][A-Z0-9_]+)=", text, re.M)}


def test_env_example_and_the_settings_class_name_the_same_variables():
    fields = {name.upper() for name in Settings.model_fields}
    keys = _example_keys()
    assert sorted(fields - keys) == [], "a setting that .env.example does not show"
    assert sorted(keys - fields - INFRASTRUCTURE_KEYS) == [], "an .env.example key that no setting reads"


# ---- the routes ---------------------------------------------------------------------------------------


def _normalised(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "{}", path.rstrip("/") or "/")


def test_every_route_a_document_names_is_a_route_of_the_api():
    schema = app.openapi()["paths"]
    api = {
        (method.upper(), _normalised(path)) for path, operations in schema.items() for method in operations
    }
    api |= {("WS", "/ws/events"), ("WS", "/ws/investigations/{}")}  # WebSockets are not in the OpenAPI
    wrong = []
    for path in DOCS:
        for number, line in enumerate(_text(path).splitlines(), 1):
            for match in re.finditer(r"\b(GET|POST|PUT|DELETE|WS)\s+(/[A-Za-z0-9_/{}-]*)", line):
                method, route = match.group(1), _normalised(match.group(2))
                if (method, route) not in api:
                    wrong.append(f"{path.relative_to(ROOT).as_posix()}:{number}: {method} {route}")
    assert wrong == []


# ---- the claims the project refuses to make ------------------------------------------------------------

# The plan's blacklist (section 7), minus the plain numbers and the words that are ordinary English.
BLACKLIST = (
    "RFC-8941",
    "RFC-6962",
    "Merkle",
    "Ed25519",
    "eBPF",
    "SEV-SNP",
    "seccomp",
    "AppArmor",
    "Kerberos",
    "Linode",
    "SanDisk",
    "Sysmon",
    "USENIX",
    "Xu et al",
    "Zero-Trust",
    "Zero Trust",
    "Byzantine",
    "air-gapped",
    "Apache 2.0",
    "Llama",
    "DeepSeek",
    "Sentinel Ω",
)
# (file, term) pairs allowed because the sentence DENIES the claim or explains a dropped design piece.
DENIALS = {
    ("CLAUDE.md", "Merkle"),
    ("CLAUDE.md", "Ed25519"),
    ("CLAUDE.md", "eBPF"),
    ("CLAUDE.md", "Byzantine"),
    (".claude/skills/SKILL-design-system.md", "Merkle"),
    (".claude/skills/SKILL-design-system.md", "Ed25519"),
    (".claude/skills/SKILL-design-system.md", "eBPF"),
}


def test_a_refused_claim_appears_in_the_documents_only_where_it_is_denied():
    found = set()
    for path in DOCS:
        relative = path.relative_to(ROOT).as_posix()
        text = _text(path)
        for term in BLACKLIST:
            if re.search(rf"(?<![A-Za-z0-9_]){re.escape(term)}", text):
                found.add((relative, term))
    assert sorted(found - DENIALS) == [], "a document makes a claim the project refuses to make"


def test_the_sandbox_is_described_as_what_it_is():
    """SKILL-security used to promise a Docker container; the sandbox is in-process mock services."""
    text = _text(ROOT / ".claude" / "skills" / "SKILL-security.md")
    assert "Docker-sandboxed" not in text and "container with no real network egress" not in text
