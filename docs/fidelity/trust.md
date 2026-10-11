# Trust & Credibility, compared with the reference

Compared 2026-10-11 at 1440 × 900, full page. The header with its three tiles, the credibility vectors beside the
trajectory chart, the isolation panel, the citation ledger and the policy configurator are in the same order and style.

| What differs | Kind | Why |
|---|---|---|
| Left sidebar instead of the top navigation | intentional, owner's directive | |
| "Protocol 88-SEC // autonomous governance", "mathematical proof of citation" and "Zero-Trust protocol" in the title | intentional, removed claim | the page says what the Watchdog does: it re-checks cited rows against raw_logs, out of band and deterministic |
| Tiles "94.6 %, +0.8 % this cycle, 0 / 3, 1 agent desync" are the mean CrS with its last change, the quarantine count and the agents with a recent discrepancy | intentional, real data | `GET /agents/fleet`, `GET /agents/{id}/credibility-history` |
| Agent cards: "HASH 0x9AF4…C119", "consensus weight 0.342", "hallucination rate" show the configured model and provider, the last vote class and the **invalid citation rate** | intentional, removed claim | there are no weights and no hash; "hallucination" was not what is measured |
| Trajectory "Rounds 1 to 10 · adaptive dynamic weight tuning" is the last scored rounds of each investigator with the real isolation threshold line and a real latest-adjustment note | intentional, real data | `credibility_log`, `GET /settings` |
| The "Trust Paradox, Xu et al. (2025)" block is a "How it works" panel and a "what agents can and cannot see" panel | intentional, removed claim | an unverifiable citation; the replacement describes the real mechanism and links the blind-test check |
| Isolation gauge with three zones (trigger < 70 %, warning < 85 %, optimal 90 %+) has the two real zones, quarantine below the threshold and active above | intentional, real data | |
| Ledger "#CIT-9941 … merkle" is the real citations, paged and filterable, each with the cited value next to the value the row holds | intentional, real data | `GET /citations` |
| Policy sliders (lockout confidence 90 %, consensus floor, bypass toggle, "policy shard ACTIVE-88-SEC") are η, the isolation threshold and the containment floor; apply and reset call `PUT /settings` | intentional, removed claim | only settings that exist are shown; each change is audited |
| Two extra panels below the configurator: the adaptive verdict floor and the evaluation against labelled scenarios | intentional | real features the reference does not have |
| **Each investigator card had a blank row at its foot that held only the Proof button** | **fixed** | the Proof now sits beside the status chip and the cards are as compact as the reference's |
| Trajectory legend sits under the chart, the reference's above it at the right | left as is | it wraps on narrow screens where a header legend would not |
