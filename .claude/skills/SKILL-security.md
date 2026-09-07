---
name: SKILL-security
description: Security requirements — auth, secrets, sandbox enforcement, and audit-trail integrity. Read before touching auth, self-healing actions, or the audit trail.
---

# VerdictChain — Security Requirements (LOCKED)

## 1. Secrets
- All secrets (`GROQ_API_KEY`, `DATABASE_URL`, JWT signing key, etc.) live in `.env`
  only, loaded via Pydantic Settings or `python-dotenv`.
- `.env` is in `.gitignore` from commit #1. Provide `.env.example` with placeholder
  keys and no real values, committed instead.
- Never print a secret to logs, error messages, or the frontend, even in a stack
  trace.

## 2. Auth
- Login uses hashed passwords (bcrypt/argon2) — never plaintext or reversible
  encryption for passwords.
- Issue a short-lived JWT (or session token) on login; protected API routes require
  a valid token via FastAPI dependency (`Depends(get_current_user)`).
- Rate-limit the login endpoint and the "Simulate scenario" trigger endpoint
  specifically (both are abuse-prone: brute-force login attempts, and
  investigation-spamming).

## 3. Input validation & injection prevention
- Every FastAPI endpoint has a Pydantic request model — no raw dict/unvalidated
  JSON body handling.
- All database access goes through the ORM (SQLAlchemy) or explicitly parameterized
  queries. String-formatted or f-string-built SQL is never acceptable, anywhere,
  even for "internal" queries.
- Sanitize any log-derived text before it's rendered in the frontend (the Raw
  Syslog / Log Explorer views render log content — treat it as untrusted user
  input for XSS purposes, even though it originates from your own dataset).

## 4. The sandbox boundary (Self-Healing Agent) — the most important rule in this file
- `self_healing/actions.py` functions (`lock_account`, `block_ip_range`,
  `trigger_rate_limiting`, `trigger_audit`) must be structurally incapable of
  reaching a real system:
  - They write ONLY to the `response_actions` table and to a local
    Docker-sandboxed mock service (e.g. a fake "directory service" and fake
    "firewall" container with no real network egress capability).
  - There is no code path, configuration flag, or environment variable that
    switches these into "real" mode. If real-system integration is ever wanted,
    it requires a deliberate new module, not a flag on the existing one.
  - `response_actions.is_simulated` is hardcoded `TRUE` at the schema level
    (see `SKILL-data-schema.md`) as a second, independent safeguard.
- Every self-healing action must be logged with a human-readable reason before
  it's considered complete (see `SKILL-agent-prompts.md` Section 6).

## 5. Audit trail integrity
- `audit_trail` entries are append-only — no UPDATE or DELETE statements against
  this table anywhere in the codebase.
- Each entry stores `prev_hash` (hash of the previous entry) and `entry_hash` (hash
  of this entry's content + `prev_hash`), forming a simple hash chain. This makes
  the log tamper-evident: recompute the chain on export/audit and flag any break.
- The blind-test boundary (agents never see `ground_truth_label` /
  `scenario_label`) is itself a security-relevant invariant — treat any code that
  would leak it into an agent's prompt as a security bug, not just a design bug.

## 6. Dependency & container hygiene
- Pin dependency versions (`requirements.txt` / `package-lock.json`) — no floating
  `latest` tags in `docker-compose.yml` for anything beyond local throwaway testing.
- Postgres/Redis/RabbitMQ containers are not exposed on public-facing ports by
  default in `docker-compose.yml` — only the FastAPI app and frontend dev server are.

## 7. What "done" means for security (checklist)
- [ ] No secret anywhere in git history (check before first push).
- [ ] Every endpoint has request validation.
- [ ] Every DB query is parameterized/ORM-based.
- [ ] Self-healing actions verified sandboxed by writing an explicit test that
      asserts no real network call is made (mock/patch and assert not called).
- [ ] Audit trail hash-chain verified by a test that tampers with one entry and
      confirms the chain-check detects it.
