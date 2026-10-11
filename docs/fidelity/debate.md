# Debate Room, compared with the reference

Compared 2026-10-11 at 1440 × 900, full page, on a finished and contained case. The case banner with its round stepper, the
Watchdog grounding strip, the three agent lanes, the deliberation stream beside the verdict aggregator, and the cited
artifacts table are in the same order with the same card structure.

| What differs | Kind | Why |
|---|---|---|
| Left sidebar instead of the top navigation | intentional, owner's directive | |
| A "How to read this page" hint strip above the banner | intentional | first-visit help, dismissible (UD18) |
| Title "CASE #INV-2026-089: Authorized SysAdmin Off-Hours Data Heist" is "DDoS · Network-Traffic Investigator · 18 cited rows" with the real case id, subject and host | intentional, removed claim | no invented case numbers or narratives; the title is derived from the verdict and the cited rows |
| Engine chip "Groq Llama-3.3-70B · 142 t/s", "Verifier V4 · Gemini-Pro ready" shows the configured provider and model and says the Watchdog is deterministic with no model | intentional, removed claim | OpenAI is the only provider; no tokens-per-second figure is measured |
| Round stepper "100 %" is complete or not, from the transcripts | intentional, real data | a round is complete when all active investigators answered |
| Agent lanes: invented hard citations ("Row #10492 4.2 GB burst") are the data slice each agent was given, its confidence trajectory, its CrS before and after and its cited-row count | intentional, real data | `GET /investigations/{id}`, `GET /citations` |
| Transcript cards ("Consensus Synthesis Daemon … Gamma concedes") are the real answers, each with its stance badge and cited rows | intentional, removed claim | the synthesis prose was typed in |
| Aggregator: consensus equation with weights, "Watchdog entropy", "weight 0.958" removed; the per-agent votes table, the quorum label and a browser recompute of the confidence are shown | intentional, removed claim | no such weights exist; the recompute must equal the server's value or a red badge shows |
| "Final synthesized verdict" card is the real class, status, supporters and evidence count | intentional, real data | |
| Self-healing list ("revoked token, 0 ms latency") is the case's real sandbox actions, each marked simulated, plus a four-check containment gate that says why a case was or was not contained | intentional, real data | `GET /investigations/{id}`; the gate mirrors `should_respond()` |
| "Re-run debate" is "Open full dossier"; "Sign forensic evidence bundle" is "Record sign-off (audited)" | intentional, removed claim | no cryptographic signature exists; a sign-off is an audited acknowledgement |
| Cited artifacts table has a Round and a row fingerprint column instead of invented serials | intentional, real data | the fingerprint is the SHA-256 of the canonical raw row |

Nothing was fixed in this pass.
