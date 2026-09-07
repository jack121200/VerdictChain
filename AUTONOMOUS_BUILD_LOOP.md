# VerdictChain — Autonomous Build Loop Guide

> This is the sequence of exact messages you paste into Claude Code, one at a time,
> to make it run its own develop → test → debug → redevelop cycle per module until
> that module genuinely works — not just "looks done".

---

## Why a loop, and why NOT "build everything, unsupervised, forever"

A fully unattended infinite loop across the WHOLE project is how you get a large
pile of code that compiles but doesn't actually work end-to-end, because nobody
checked the seams between modules. The loop below is scoped **per module**, with a
hard exit condition, and a mandatory regression check before moving to the next
module. This is what makes it safe to say "keep going until this is genuinely done"
without it wandering off or quietly breaking something else.

---

## Step 0 — One-time session bootstrap

Paste this first, every new session:

```
Read CLAUDE.md and every file in /.claude/skills/. Summarize the locked stack, the
golden rules, and the regression-guard protocol back to me in 5 lines before doing
anything else.
```

Confirm the summary is accurate before proceeding. If it's wrong or vague, stop and
re-point it at the specific skill file it missed.

---

## Step 1 — The per-module autonomous loop (this is the core prompt)

For each module in the build order (Data Layer → Log Pipeline → Investigator
Agents → Debate Engine → Watchdog → Self-Healing → FastAPI Layer → Frontend Wiring
→ Tests/CI), paste this, filling in `<MODULE NAME>` and `<SKILL FILES>`:

```
We are building Module: <MODULE NAME>.
Relevant skill files: <SKILL FILES, e.g. SKILL-architecture.md, SKILL-data-schema.md>

Run this exact loop yourself, without asking me for permission between steps,
UNTIL every item in the "Definition of Done" checklist from SKILL-conventions.md
is true for this module. If you get stuck after 3 genuine attempts at the same
error, STOP and report to me instead of continuing to guess.

LOOP:
1. PLAN — read the relevant skill files. Write a short implementation plan: files
   to create/change, key functions, tests to write. Post it, then proceed
   (no need to wait for my approval on this module — only stop early if something
   in the skill files is ambiguous or contradictory).
2. BUILD — implement the smallest correct version per SKILL-conventions.md.
3. TEST — write tests first if they don't exist, then run the full test suite for
   this module. Show me the actual passing/failing output, not a summary claim.
4. DEBUG — if anything fails: diagnose the root cause (don't just retry blindly),
   fix it, and re-run. Repeat until green, or until you've made 3 genuinely
   different attempts — then stop and report what you tried and where it's stuck.
5. REGRESSION CHECK — run the Regression-Guard Protocol from CLAUDE.md: identify
   every other module that depends on what you touched, re-run THEIR tests too.
   If anything that used to pass now fails, go back to step 4 for that specific
   regression before continuing.
6. VERIFY AGAINST DEFINITION OF DONE — go through the checklist in
   SKILL-conventions.md line by line. If anything is unchecked, go back to the
   relevant step. Only when every line is checked, proceed to step 7.
7. COMMIT — write a clear commit message covering what changed and which modules
   were re-verified. Then STOP and give me a short summary: what you built, what
   you tested, what (if anything) still needs my input.

Do not mark this module complete until you can literally run it and show me real
output proving it works — no "this should work now" claims.
```

---

## Step 2 — Between modules

After each module's summary comes back:
1. Skim the summary and the diff for anything that looks off.
2. `/clear` to wipe context before the next module (keeps it from getting confused
   by stale details from the last one).
3. Paste Step 1's prompt again with the next module's name.

---

## Step 3 — Hard modules get an extra instruction

For anything genuinely tricky — the debate state machine, the credibility formula,
concurrency in RabbitMQ consumers, the hash-chained audit trail — prepend this to
the Step 1 prompt:

```
This module has non-trivial logic. Think step by step through the full state
space and edge cases BEFORE writing any code. Write out your reasoning, then
implement.
```

---

## Step 4 — Full end-to-end verification loop (after all modules are individually done)

Once every module has passed its own loop, run this once:

```
All individual modules report done. Now run a full end-to-end verification loop:

1. Bring up the entire stack with `docker compose up` and confirm every service
   starts without error.
2. Use the Playwright MCP to open the actual dashboard, log in, trigger a manual
   "Simulate scenario" (password-spraying), and confirm: the debate transcript
   populates with 3 real rounds, the trust log shows real credibility scores
   (including at least one realistic case where a score changes), a verdict is
   reached, and — if confidence is high enough — a self-healing action appears in
   the response actions log, all with real timestamps, not placeholders.
3. Confirm every chart/bar/badge on the dashboard is reading from a real API
   response (grep the frontend for any leftover mock data and remove it if found).
4. Run the full backend test suite one final time, all green.
5. If ANY of the above fails, treat it as a new bug: diagnose, fix, re-run the
   regression-guard protocol for whatever you touched, and repeat this whole
   Step 4 verification from the top — do not just patch the one failing point
   and declare success.

Only report "VerdictChain is fully working end-to-end" once all 4 checks pass in
the same run.
```

---

## Step 5 — What to do if it gets stuck (you will hit this eventually)

If Claude Code reports it's stuck after 3 attempts on the same problem:
1. Ask it to explain, in plain language, exactly what it tried and why each attempt
   failed — this alone often surfaces the real issue.
2. If it's a design ambiguity (something the skill files didn't specify clearly),
   YOU decide the answer, tell it explicitly, and — if it's a durable decision —
   add one line to the relevant `SKILL-*.md` file so it doesn't come up again.
3. If it's a genuine bug it can't find, ask it to add targeted logging/print
   statements, re-run, and read the actual output with you before guessing again.
4. Never let it "route around" a stuck point by silently changing the architecture
   (e.g. switching libraries, changing the schema) without flagging that decision
   to you first — that's exactly the kind of silent drift the golden rules exist
   to prevent.

---

## Quick reference — the full module order to loop through

1. Data Layer (Postgres schema + docker-compose)
2. Log Pipeline (ingestion, normalization, feature extraction, log streamer)
3. Investigator Agents (Network-Traffic, Access-Log, Endpoint-Behavior)
4. Debate Engine (3 rounds + verdict aggregation)
5. Watchdog / Trust Agent (credibility scoring + verification)
6. Self-Healing Response Agent (sandboxed containment actions)
7. FastAPI Layer (REST + WebSocket, auth, validation)
8. Frontend Wiring (Figma Make React code → real API/WebSocket data)
9. Tests + CI/CD (GitHub Actions) + Step 4's full end-to-end verification loop
