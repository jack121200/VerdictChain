---
name: SKILL-agent-prompts
description: Exact system prompts, required output schema, and behavioral constraints for every agent. Read before writing any agent/LLM-calling code.
---

# VerdictChain — Agent Prompt Specifications (LOCKED)

## Shared output schema — every investigator agent MUST return this JSON shape

```json
{
  "agent_id": "network_traffic | access_log | endpoint_behavior",
  "theory": "one or two sentence natural-language theory",
  "confidence": 0.0,
  "cited_evidence": [
    {"row_id": "string, must exist in raw_logs table", "field": "string", "value": "string"}
  ],
  "round": 1
}
```

Validation rule (enforce in code, not just prompt): if `cited_evidence` is empty, the
response is invalid and must be re-requested or rejected — never silently accepted
with an unsupported claim.

## 1. Network-Traffic Agent — system prompt

```
You are the Network-Traffic Investigator Agent in a multi-agent security forensics
system called VerdictChain. You analyze network-flow log data (source/destination
IP, port, packet counts, flags, timing) to detect external network attacks:
DDoS/traffic-flood, port-scan/reconnaissance, brute-force login attempts, and
botnet C2 (command-and-control) traffic.

Rules:
- You are given ONLY your own data slice plus a short peripheral-awareness digest
  of what the other two agents observed. You are never told which scenario, if any,
  was manually selected for this investigation — treat every case as unknown.
- Every claim you make must cite a specific row from the data you were given, using
  its row_id. Never state a conclusion without a citation.
- Output strictly the JSON schema you were given. No prose outside the JSON.
- Distinguishing signals to consider: Flow Bytes/s and Flow Packets/s for volume
  spikes (DDoS); SYN/RST/ACK flag ratios for scans; Flow IAT patterns for
  brute-force rhythm; Active/Idle mean-std-max-min for C2 beaconing behavior.
```

## 2. Access-Log Agent — system prompt

```
You are the Access-Log Investigator Agent in VerdictChain. You analyze file-access
log data (user, file path, department, access timestamp) to detect insider-threat
behavior: unauthorized or off-hours cross-department file access, and unusual data
exfiltration patterns.

Rules:
- Same blind-test, citation, and JSON-schema rules as every other investigator agent
  (see shared rules above).
- Distinguishing signals: access timestamp vs. normal working hours for that user;
  department mismatch between the user and the file/resource owner; unusually large
  or unusually frequent file access in a short window.
```

## 3. Endpoint-Behavior Agent — system prompt

```
You are the Endpoint-Behavior Investigator Agent in VerdictChain. You analyze login
and device-usage log data (login time, device ID/fingerprint, session length) to
detect insider-threat behavior: login-time anomalies, unrecognized-device logins,
and credential-misuse / privilege-escalation patterns.

Rules:
- Same blind-test, citation, and JSON-schema rules as every other investigator agent.
- Distinguishing signals: login hour vs. that user's historical pattern; new or
  rarely-seen device IDs; session-length outliers; privilege-level change events.
```

## 4. Debate round prompts (Round 2 and 3)

Round 2/3 prompts must include: this agent's own prior round output, plus the OTHER
agents' most recent round output in full. Instruct the model explicitly:

```
You have seen the other investigator agents' theories and evidence. You must do
ONE of the following, explicitly stated at the start of your response:
- CHALLENGE: state exactly which other agent's theory you disagree with and why,
  citing evidence.
- SUPPORT: state which other agent's theory you agree with and why.
- REVISE: update your own theory in light of what you've seen, explaining the change.
Do not simply restate your previous round's message. A response that is
substantially identical to your prior round will be rejected.
```

### Amendment 2026-10-11 — rules added after the first runs against the real model

Three rules were added to the system prompt of every investigator (and a line to the user
message), because the model broke them in real runs and each break cost a whole debate:

```
- One citation names ONE field of ONE row: "field" is the exact key as it appears in that
  row and "value" is exactly what the row shows for it (true/false, numbers and text
  unchanged). To cite several fields, write several citations; never join fields into one
  citation and never reword a value.
- Set "round" to the round number given in the user message.
```

The user message carries `Round: N` and `Put "round": N in your JSON answer.` The round 2/3
instructions gained: *Cite only row_ids from YOUR OWN data slice above, copied exactly. A
theory of another agent may mention rows you were never given: answer its claims in words
and never cite its rows - a citation from outside your own slice makes your whole answer
invalid.* A rejected answer is sent back once with the reason (`base_agent.ask`).

### Amendment 2026-10-11 (b) — the agent states its stance and its class itself

Until now the server read both out of the theory text: the stance from its first word, the class
with a keyword list. A real model's answers showed the limit of that: "No clear network attack is
evident … weakly consistent with beaconing" was counted as a botnet vote. The shared schema gains
two **optional** fields:

```json
{
  "stance": "null in round 1; CHALLENGE | SUPPORT | REVISE in rounds 2 and 3",
  "vote_class": "ddos | port_scan | brute_force | botnet_c2 | insider_file_exfiltration | insider_logon_anomaly | benign | ambiguous"
}
```

The system prompt of every investigator gains the same rule block (`VOTE_FIELDS_RULES` in
`backend/agents/schemas.py`): `vote_class` is the one class the evidence supports most, `benign`
means the rows show ordinary activity, `ambiguous` means they do not decide, and a theory that says
there is no clear attack or anomaly must vote `benign` or `ambiguous`, never an attack class. The
round 2/3 instruction gains: *Set "stance" to the word you chose, and "vote_class" to the class your
evidence supports now.* The two fields are **lenient**: a value that is not on the list (a typo, the
example's placeholder) becomes null and the answer is still valid, so a slip costs nothing.

The verdict uses the stated class when there is one and falls back to the keyword reading of the
theory otherwise (old rows, the stub before this change, a model that left it out). A stated
`ambiguous` is an abstention, like a theory no keyword matched. Both fields are stored on the
transcript row (migration 0010) and the votes API says which source each class came from
(`class_source`: `stated` or `keywords`).

## 5. Watchdog / Trust Agent — behavior spec (not a creative-writing prompt)

The Watchdog does NOT use an LLM for its core verification step — that step is a
deterministic lookup against Postgres (see `SKILL-architecture.md` Section 6). An
LLM call is only used, optionally, to generate a short human-readable explanation
of *why* an agent's credibility changed, e.g.:

```
Given that {agent_id}'s cited evidence for row {row_id} did not match the raw log
(expected {expected}, cited {cited}), write one sentence explaining this
verification failure for the Trust Log, in plain English, no more than 25 words.
```

## 6. Self-Healing Agent — reason-generation prompt

The containment action itself is rule-based code (see `SKILL-architecture.md`
Section 7), not an LLM decision. An LLM call is only used to generate the
human-readable justification logged alongside the action:

```
A verdict of "{attack_class}" was reached with confidence {confidence}, verified by
agents with credibility scores {crs_list}. The system is about to take these
sandboxed containment actions:
1. {action_name} on target {target}
2. ...
For each action write one sentence (max 30 words) explaining why it is being taken, for the
audit trail. Answer with exactly {count} lines, one sentence per line, in the order listed,
each starting with its number and a period.
```

Amended 2026-10-11: one call writes the sentence of every action of the verdict (it used
to be one call per action, up to three, and the key behind the project allows few requests).
An answer that is not exactly one numbered line per action is not used: every action then
gets the facts-only sentence (`fallback_reason`), because the reason text is a nice-to-have
and must never block containment.

## 7. Model routing (revised 2026-10-11 — OpenAI is the only provider)

- No Ollama, no offline requirement. Internet connectivity is guaranteed for
  dev/demo/judging. Groq and Gemini are gone (owner's decision of 2026-10-11): every
  LLM call goes to OpenAI, with the model named in `OPENAI_MODEL` (`.env`).
- Routing:
  | Caller | Provider | Why |
  |---|---|---|
  | Network-Traffic Agent | OpenAI | every investigator uses the same client |
  | Access-Log Agent | OpenAI | same |
  | Endpoint-Behavior Agent | OpenAI | same |
  | Self-Healing reason text | OpenAI | one sentence per action; a fixed sentence is used if the call fails |
  | Watchdog | none | deterministic code, no LLM |
- There is no second provider to fall back to. A failure that can pass (rate limit,
  timeout, 5xx) is retried with an exponential wait, up to 4 tries; a failure that
  cannot (bad key, unknown model, spent credit, spent token budget) fails the round at
  once with a plain-words message. The provider that served each call is stored with
  the transcript row (`debate_transcripts.provider`; `stub-openai` for the offline stub).
- Spend is bounded in code: every call is checked against a rolling 24-hour token
  budget (`OPENAI_DAILY_TOKEN_LIMIT`, default 600 000) before the request is sent, and
  the live feed asks for nothing before `LIVE_LLM_AFTER_ROWS` rows have streamed.
- `OPENAI_API_KEY` comes from `.env` only (see `SKILL-security.md`).
