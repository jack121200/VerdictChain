# Audit Trail, compared with the reference

Compared 2026-10-11 at 1440 × 900. The header, the four tiles, the Ledger / Containment tabs, the entry list on the left
and the entry inspector on the right are in the same order with the same card and tab style. The list is far longer than the
reference's because the database holds hundreds of real entries.

| What differs | Kind | Why |
|---|---|---|
| Left sidebar instead of the top navigation | intentional, owner's directive | |
| A "How to read this page" hint strip | intentional | first-visit help (UD18) |
| "Block height #88,412 · finalized on shard 01" is the chain head sequence number and the number of entries | intentional, removed claim | there is no blockchain and no shards |
| "Integrity 100 % intact" is the result of a server verification (the full pass on demand) and the browser's own recompute of the selected entry | intentional, real data | `POST /audit-trail/verify`, SHA-256 in the browser over the entry's exact `hash_input` |
| "Signature scheme Ed25519", "valid signature", "RFC-8941 structured header", "Merkle tree linkage" are the SHA-256 hash chain: `prev_hash`, `entry_hash` and the exact text that was hashed | intentional, removed claim | no signature scheme exists; the chain is tamper-evident, not signed |
| The button keeps the reference's words "Verify cryptographic proof"; what it runs is the server's full hash-chain verification, and the inspector's green tag follows the browser's own recompute | intentional, real data | the tag was static once; fixed in TA4. The label is the one place the reference's wording stays: SHA-256 is a cryptographic hash, but the page makes no signature claim |
| "Export custody bundle" is kept and exports the entries and the head hash as JSON | intentional, real data | the printable chain-of-custody record of one case (PDF) is on that case's dossier |
| The Containment tab lists the real sandbox actions with their simulated flag | intentional, real data | `GET /response-actions` |

Nothing was fixed in this pass.
