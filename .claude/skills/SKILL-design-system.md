---
name: SKILL-design-system
description: Exact design tokens from the locked Figma design — colors, fonts, spacing, agent identity system. Read before writing or wiring any frontend UI.
---

# VerdictChain — Design System (LOCKED, must match Figma 1:1)

## Theme
Single dark theme only. No light-mode toggle. "Forensic tribunal / mission-critical
intelligence console" personality — not a generic SaaS look.

## Color tokens
| Token | Hex | Usage |
|---|---|---|
| bg-base | #0A0A0F | page background |
| bg-surface | #14141F | cards/panels |
| bg-surface-elevated | #1E1E2E | modals, dropdowns, tooltips (elevation via lightness, NOT shadows) |
| border-default | #2E2E42 | dividers, card borders |
| accent-violet | #8B5CF6 | THE reasoning/debate/AI-action accent — active nav, primary buttons, agent-speech accents, focus rings |
| accent-gold | #F0B429 | VERDICT ONLY — final classification seals, confidence displays at the verdict moment. Rare = powerful. Never decorative. |
| status-critical | #F04438 | confirmed threat / isolated agent |
| status-warning | #F79009 | investigating / degraded credibility |
| status-safe | #12B76A | verified / trusted / resolved |
| status-info | #36BFFA | evidence verified against raw logs |
| text-primary | white @ 100% | |
| text-secondary | white @ 70% | |
| text-disabled | white @ 40% | |

**Strict rule:** violet = AI reasoning, gold = verdict, red/amber/green/blue = status
only. Never mix these roles. Every status badge pairs its color with a distinct icon
shape (triangle=critical, circle=warning, check=safe, shield=verified) — color alone
is never the only signal (accessibility requirement).

## Typography
Three families, each with one job — never substitute:
- **Space Grotesk** — headings only. H1 32px/40px Bold, H2 22px/30px SemiBold,
  H3 17px/24px SemiBold.
- **Inter** — all UI/body text. Body 14px/20px Regular, Caption 12px/16px Regular,
  Label 11px/14px Medium, 0.4px letter-spacing, uppercase for section labels.
- **JetBrains Mono** — data/evidence ONLY: raw log lines, cited evidence rows, IDs,
  IPs, hashes, timestamps. This is a signature detail — apply it consistently
  everywhere evidence appears, never use mono for ordinary UI text.

## Spacing & shape
- 4px base grid: only 4/8/16/24/32/48/64px for padding/margin.
- Corner radius: 10px for cards/inputs/buttons; full-round for pills/badges.
- 12-column layout grid, 24px gutters, max content width 1440px.
- Icons: Lucide only, consistent stroke width.

## Signature motifs (apply consistently, these are what make it feel designed)
- A subtle 1px violet-to-transparent gradient hairline along the top edge of
  active/important cards.
- Agent identity chips (see below) used everywhere an agent is referenced —
  dashboard, debate transcript, trust log, agent fleet.
- Credibility scores always rendered as a horizontal bar + numeric value together
  — never a bare number.
- Verified evidence gets a small inline shield-check seal (gold or info-blue).

## Agent identity system (fixed — use everywhere, never reassign)
| Agent | Monogram | Color |
|---|---|---|
| Network-Traffic Agent | NT | #36BFFA (status-info) |
| Access-Log Agent | AL | #8B5CF6 (accent-violet) |
| Endpoint-Behavior Agent | EB | #12B76A (status-safe) |
| Watchdog / Trust Agent | WD | #F0B429 (accent-gold) |
| Self-Healing Response Agent | SH | #F04438 (status-critical) |

## Elevation
Achieved through the three background lightness steps (base → surface →
surface-elevated), not drop shadows — shadows barely read on a near-black
background. Any "raised" element gets the next lightness step, not a box-shadow.

## Frontend implementation note
The existing Figma Make React/TypeScript code already encodes these tokens (as CSS
variables / Tailwind config, depending on what Figma Make generated). When wiring
real data into it:
- Reuse the existing token variables and component structure — do not introduce a
  parallel/competing set of colors or a second component library.
- If a new component is needed that Figma Make didn't generate, match these tokens
  exactly rather than inventing new values.
- No hardcoded colors/fonts in new component code — always reference the token
  variables.
