# Agent Fleet, compared with the reference

Compared 2026-10-11 at 1440 × 900, full page. The four summary tiles, the card grid on the left (seven columns) and the
inspector on the right (five columns) are in the same places with the same card style.

| What differs | Kind | Why |
|---|---|---|
| Left sidebar instead of the top navigation | intentional, owner's directive | |
| "Active agents 5 / 5", "100 % enclave isolation", "mean fleet credibility 96.4 %", "citation accuracy 98.6 %" are live: the three investigators plus the Watchdog and Self-Healing services, the mean CrS (n = 3) and the verified share of all citations | intentional, real data | `GET /agents/fleet`, `GET /stats`; "enclave isolation" removed (no mechanism) |
| "Consensus mode: 3-round dialectic · RFC-8941" shows the debate length from the settings | intentional, removed claim | |
| Agents "Alpha, Beta, Gamma, Delta, Epsilon, Sentinel Ω" are Network-Traffic, Access-Log and Endpoint-Behavior, plus the Watchdog and Self-Healing service cards | intentional, real data | there are three investigators; Delta and Epsilon never existed |
| Specialization text ("TLS 1.3 entropy analysis"), model "Gemini 2.5 Flash", temperature "0.0 strict" are the agent's real signals, configured model and temperature (0.2) | intentional, real data | `GET /agents/fleet` |
| "Consensus voting weights 0.35 / 0.40 / 0.25", "memory isolation: sandbox protected", "10 Gbps tap" are the last vote class, the votes in the latest debate and the real row counts of the latest case | intentional, removed claim | there are no weights; the isolation claim had no mechanism |
| "Byzantine fault test" is a dry-run fault injection: it runs the real citation check on a made-up citation and projects the CrS path with the real formula, then re-reads production CrS to show it did not move | intentional, removed claim | audited, needs `override_fault_weights`; it writes nothing |
| Quarantine and restore are real, role-gated and audited actions; a running debate answers 409 | intentional, real data | `POST /agents/{id}/quarantine`, `/restore` |
| **The card grid on the left stretched its rows to the height of the inspector, so the cards had large empty areas** | **fixed** | the grid now keeps each card's own height (`content-start`) |
