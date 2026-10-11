# Dashboard, compared with the reference

Compared 2026-10-11 at 1440 × 900, full page. Same order: incident banner, four KPI tiles, the attack-dataset bar, the pod
triad, the verdict ledger beside the event stream, and the evidence cards.

| What differs | Kind | Why |
|---|---|---|
| Left sidebar instead of the top navigation | intentional, owner's directive | |
| Banner "Active incident … #INV-2026-089, usr:admin_clark99, WS-CORP-FIN-091" is the latest threat verdict with its real subject and host | intentional, real data | derived from that case's cited rows; "No threat verdict yet" when there is none; "Zero egress drift" removed (no mechanism) |
| KPI tiles (08 running, 04 critical, 91.4 %, 14 quarantines) are live counts and means | intentional, real data | `GET /stats`, `GET /agents/fleet`; each with n and a Proof |
| Five invented attack presets are the eight real scenario labels | intentional, real data | `GET /scenarios`; "Ground-truth: masked from pod swarm" has a Proof naming the blind-test check |
| Pods "Netflow #01 / Access-Log #02 / Endpoint Sentry #03" are the real investigators with their real stance quotes | intentional, real data | `GET /agents/fleet`, `GET /investigations/{id}`; "formal stance" is the server-parsed stance and class |
| Pod charts (payload entropy, kernel histogram "+412 %") are confidence by round and a citation count | intentional, removed claim | the originals had no data behind them |
| Ledger "#VC-4409 … 0x7F2…91C" is the recent investigations with their real audit hash | intentional, real data | there are more rows than the reference's four because the database has more cases |
| "Terminal bus stream", "eBPF ring", "inject noise", "reset watchdog" are the audit event stream (newest last, "clear" hides the view only) | intentional, removed claim | noise is a scenario-modal option; the watchdog has no reset |
| Photos with invented captions ("USB mass storage intercept", "turnstile north-04") keep the pictures with real cited rows as captions | intentional, removed claim | the physical-evidence claims had nothing behind them |
| **Pod chart box had blank space under the line; the Proof sat on its own row** | **fixed** | the Proof now sits in the header row beside the value and the chart is a little shorter |
| **Event stream box stopped at a fixed height and left the panel half empty; it did not follow new lines** | **fixed** | it now fills the panel beside the ledger, scrolls inside, and keeps the newest line in view |
