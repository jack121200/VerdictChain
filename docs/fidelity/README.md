# Fidelity to the reference design (UD8, UD16, PH7)

The owner asked for an exact copy of the approved reference look (the AI Studio export kept locally in `reference/`,
never committed), with real data in place of its mock numbers and the claims we cannot prove removed. This folder is the
record of the check, one file per page.

**How it was checked (2026-10-11).** Both apps were opened at 1440 × 900 with Playwright, page by page, and compared as
full-page screenshots, section by section: order, spacing, type scale, colours, glows, card structure and density. The
reference runs on port 3001 from its own `vite` install; this app runs on the real API with the development database.
The capture scripts are not part of the repository (they live in the session's scratch folder), so the check is
repeatable by anyone with the reference export: open both and compare.

**What counts as a difference.** Each file lists every difference found and says which kind it is:

- **fixed**: the app differed from the reference for no good reason and was changed in this pass.
- **intentional, real data**: the reference shows a typed-in number or sentence; this app shows the API field (with its
  Proof popover) in the same place and the same style.
- **intentional, removed claim**: the reference states something the project has no mechanism for (the plan's blacklist,
  section 7, enforced by `frontend/scripts/no-bluff-check.mjs` and the claims audit); it is replaced by what is true.
- **intentional, owner's directive**: the left sidebar instead of the top bar (2026-10-08), and the features added at the
  owner's request (the operations board, the case pipeline strip, the Self-Healing panel, the printable PDFs).

**The pages**

| Page | File | Result |
|---|---|---|
| Overview | [overview.md](overview.md) | structure identical, every number real |
| Dashboard | [dashboard.md](dashboard.md) | structure identical; two fixes in this pass |
| Debate Room | [debate.md](debate.md) | structure identical, additions listed |
| Trust & Credibility | [trust.md](trust.md) | structure identical; one fix in this pass |
| Investigations | [investigations.md](investigations.md) | list and dossier identical in structure; the owner asked for more |
| Agent Fleet | [fleet.md](fleet.md) | structure identical; one fix in this pass |
| Audit Trail | [audit.md](audit.md) | structure identical |
| Access & System | [access.md](access.md) | structure identical, real controls instead of invented ones |

**Landing and Login have no counterpart.** The reference export has no landing or sign-in screen (it opens straight on the
Overview), so there is nothing to compare them with. They were built from the design system (`SKILL-design-system.md`
v2) with the same tokens, fonts and card style, and carry no mock data.

**Not copied on purpose, everywhere.** Mock numbers, invented case ids, hosts, hashes and serials, the "RFC", "Merkle",
"Ed25519", "eBPF", "Zero-Trust" and "Byzantine" wording, the literature statistics, the model names that are not
configured, and the license badges. The reasons are in the plan (section 2) and in `docs/CLAIMS_AUDIT.md`.

**Contrast.** The tokens are identical to the reference's; the WCAG check of every pair in use is in
[contrast.md](contrast.md). The printed documents (case report and chain of custody) use their own light "paper" tokens,
listed there too.
