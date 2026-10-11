# Access & System, compared with the reference

Compared 2026-10-11 at 1440 × 900, full page. The title with its action button, the identity banner, the two-column body
(left: policy and privilege cards; right: health and quick links) and the footer strip are in the same order and style.

| What differs | Kind | Why |
|---|---|---|
| Left sidebar instead of the top navigation | intentional, owner's directive | |
| "Zero-Trust administration" eyebrow and "Zero-Trust credential verification" subtitle | intentional, removed claim | the page says it shows the signed-in identity, the RBAC matrix, user administration, service health and audited containment controls |
| "Trigger emergency containment" in the header is "Pause new investigations" | intentional, removed claim | the original "terminates sessions, revokes Kerberos" had no mechanism; pausing intake is real, audited and gates `POST /investigations/simulate` with 423 |
| Identity banner ("SecOps Lead Analyst, VC-8821, session token ed25519:…, Node-US-West-04") is the signed-in user's name, role and id and the token's real expiry | intentional, real data | `GET /auth/me`; the role switcher is removed because it would be impersonation |
| "Active autonomous defense policies" (auto-quarantine at 90 %, NTP skew, mirror lockstep) | intentional, removed claim | none is implemented; the card shows the real intake switch and the read-only containment floor |
| "Zero-Trust privilege matrix" with four invented roles is the real matrix: eight capabilities by four roles | intentional, real data | `GET /rbac/matrix` |
| "Postgres shard replica health" (three replicas, 0 ms lag) is the real health of PostgreSQL, Redis and RabbitMQ with latency, the OpenAI model, its allowance and the sandbox violation counter | intentional, real data | `GET /system/status` |
| Added: user management (change a role, with a last-lead guard), per-case sandboxed containment and release, and the data sources with real row counts | intentional | real, role-gated and audited controls from the plan (section 2.10) |
| Quick links keep the four tiles; their targets are the real pages | intentional, real data | |

Nothing was fixed in this pass.
