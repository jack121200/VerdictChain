# Overview, compared with the reference

Compared 2026-10-11 at 1440 × 900, full page, both apps. The section order, the hero, the four-number ribbon, the console
preview, the four pillar cards, the lower band, the four foundation cards and the closing call to action are all in the
same place with the same spacing, type scale, colours and glows.

| What differs | Kind | Why |
|---|---|---|
| Left sidebar instead of the top navigation | intentional, owner's directive | one structural change, ordered 2026-10-08 |
| Badge "IEEE / ACM · RFC-8941 compliant" is "Multi-agent debate · Watchdog verification · Simulated response" | intentional, removed claim | no standard is claimed or met |
| Headline "Deterministic Forensic Adjudication for Authorized Insider Threats" is "Multi-agent forensic adjudication for insider and network threats" | intentional, removed claim | the aggregation is deterministic code, the model output is not |
| Ribbon (99.82 %, < 4.2 s, 100 %, "Zero Loss") shows evaluated accuracy, adjudication latency, grounding and simulated share | intentional, real data | `GET /evaluation`, audit timestamps, `GET /stats`; each has n and a Proof; an empty value shows "—" with its reason |
| Console preview: invented log lines, "99.82 %", "Kerberos token" card | intentional, real data | the newest rows of `GET /raw-logs/recent`, the latest verdict's agent-reported confidence, one real cited row |
| Pillars: "120k eps", "Merkle-backed", "eBPF", "0.00 % hallucination", "instant restore" | intentional, removed claim | replaced by the real ingested counts per source, the real investigator names, the invalid-citation and discrepancy counts, the simulated share and sandbox violations |
| "Why single-agent LLMs fail" panel with literature figures | intentional, removed claim | an unverifiable statistic; the slot shows the scenario suite instead: the eight real labels, their dataset, primary agent and row count |
| Foundation cards (Merkle chain, Brier drift, Docker jail, model-agnostic list) | intentional, removed claim | the SHA-256 hash chain with its real length and validity, the learning rate η and the Brier score (null until analyst feedback exists), the sandbox violation counter, the configured model |
| Closing band: "air-gapped lab", license badges | intentional, removed claim | no such claim; the band offers the console and the investigations |
| Gap between the pillars and the scenario suite is a little taller than the reference's | intentional | the suite has a heading row and a caption that the reference's panel does not |

Nothing was fixed in this pass: no difference was found that was not one of the above.
