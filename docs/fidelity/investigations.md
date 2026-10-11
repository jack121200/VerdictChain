# Investigations, compared with the reference

Compared 2026-10-11 at 1440 × 900, full page. The header, the search and filter bar, the list of dossiers on the left (seven
columns) and the sticky dossier inspector on the right (five columns) are in the same places with the same card style.

| What differs | Kind | Why |
|---|---|---|
| Left sidebar instead of the top navigation | intentional, owner's directive | |
| Six invented dossiers ("INV-2026-094 Insider Exfiltration", UID-8819) are the real cases, with server-side search and filters | intentional, real data | `GET /investigations`; the filters are query parameters, nothing is filtered in the browser |
| Dataset chips (All / CERT / CICIDS / Synthetic BFT) are inside the Filters menu as the primary agent, which fixes the dataset | intentional | the list endpoint filters by primary agent, so a dataset chip row would have to guess; "Synthetic BFT" is removed (Byzantine claim) |
| "MERKLE ROOT VALID" is "Audit chain valid" | intentional, removed claim | a SHA-256 hash chain, not a Merkle tree |
| "SHA-256 digest 0x8a9f…" is the real evidence bundle digest; "attributed subject" and "trigger event" are derived from the cited rows | intentional, real data | the formulas are in the Proof |
| "IP revoke & key purge … within 180 ms" is the case's real sandbox actions and the measured verdict-to-first-action time | intentional, real data | |
| "Raw evidence asset" photo keeps the picture with a real cited row as its caption | intentional, removed claim | |
| "Re-debate case" is "Open replay" | intentional, removed claim | a replay reads stored transcripts and calls no model |
| The first dossier is not open on arrival; the right panel asks for a case | intentional | each dossier is five requests (case, bundle, citations, audit entries, audit chain); a deep link or a click opens one |
| **Added at the owner's request on 2026-10-11, because the page looked plain:** the operations board (what the monitor started and finished by itself, medians, and one lane per debate slot), a Detect → Debate → Verdict → Contain strip on every case, an automation timeline, a full Self-Healing panel (gate, playbook, sandbox boundary, release), an evidence storyline, and the **Report PDF** and **Custody PDF** buttons | intentional, owner's directive | every figure is an API field or a derivation with its formula in a Proof; the PDFs print through the browser's own dialog |
