---
name: SKILL-design-system
description: Approved HUD design v2 (decided 2026-10-05) - exact tokens, type, icons, agent chips, status shapes and the no-bluff rules. Read before writing or wiring any frontend UI.
---

# VerdictChain — Design System v2 (LOCKED, approved 2026-10-05)

**This file supersedes the v1 token table and its rules (list in §12).** The target look is the reference export `reference/verdictchain---multi-agent-soc/` (read-only, git-ignored, never pushed). Port it onto the real API. Every value on screen is real data (no-bluff contract, §11).

## 1. Personality
Single dark theme. A multi-agent forensic console: dense HUD panels, hairline accents, monospace evidence. Labels say what the system does. No marketing claims.

## 2. Colour tokens
Exact hex from the reference `@theme` (`src/index.css`). Defined once in `frontend/src/styles/tokens.css` as Tailwind v4 `@theme` variables. Components use the utility name.

| Group | Utility → hex |
|---|---|
| Primary | `primary` #4cd7f6 · `primary-container` #06b6d4 · `on-primary` #003640 · `on-primary-container` #00424f |
| Secondary | `secondary` #4edea3 · `secondary-container` #00a572 · `on-secondary` #003824 · `on-secondary-container` #00311f |
| Tertiary | `tertiary` #ffb95f · `tertiary-container` #e79400 · `on-tertiary` #472a00 · `on-tertiary-container` #563400 |
| Error | `error` #ffb4ab · `error-container` #93000a · `on-error` #690005 · `on-error-container` #ffdad6 |
| Surfaces | `background` #0a0e15 · `surface` and `surface-dim` #0f131b · `surface-bright` #353941 · `surface-container-lowest` #070a0f · `surface-container-low` #13171f · `surface-container` #1c2027 · `surface-container-high` #262a32 · `surface-container-highest` #31353d |
| Text and lines | `on-surface` #dfe2ed · `on-surface-variant` #bcc9cd · `outline` #869397 · `outline-variant` #3d494c |

Five added tokens (plan §4). Their values are the reference's own raw hex, now named: `surface-card` #181c23 (cards) · `primary-fixed` #acedff · `secondary-fixed` #6ffbbe · `on-secondary-fixed` #002113 · `error-strong` #ba1a1a (solid critical fill).

**Shadows** (named tokens; the only shadows allowed). This replaces the v1 "no shadows" rule.
- Glow: `shadow-glow-cyan` 0 0 16px rgba(6,182,212,0.35) · `shadow-glow-emerald` 0 0 16px rgba(78,222,163,0.35) · `shadow-glow-amber` 0 0 16px rgba(255,185,95,0.35) · `shadow-glow-crimson` 0 0 16px rgba(239,68,68,0.45). Values from the reference `.glow-*`. Crimson is the one hue outside the palette, and it is used for glow only.
- `shadow-panel` 0 4px 24px rgba(0,0,0,0.6) (top nav). `shadow-hero` 0 20px 60px rgba(0,0,0,0.85) (Overview hero).
- Cards use Tailwind `shadow-md`. Large panels use `shadow-xl`. Sticky side panels and the Overview callout use `shadow-2xl`. These are Tailwind defaults, as in the reference.
- Reference shadows not listed above (inline `shadow-[...]` glows of 12–28 px on buttons, toasts and selected cards, and the footer's upward `0 -1px 8px rgba(0,0,0,0.5)`) map to the nearest listed token and are listed for review in the port.

**Overlays.** Modal scrim: `surface-container-lowest` at 80% with `backdrop-blur-md`. Top nav and footer: `surface-container-lowest` at 90% with `backdrop-blur-xl` / `-md`. Toast: `background` at 95%, `rounded-xl`, border in the status colour (`primary` by default).

## 3. Colour roles
| Role | Token | Used for |
|---|---|---|
| Interactive and live | `primary` | links, focus ring, icon buttons (`primary` at 10% fill, 30% border, `primary` glyph), live dot |
| Active nav item | `primary-container` fill, `on-primary` text, bold | the one active navigation item, with `shadow-glow-cyan` |
| Verified, healthy, safe | `secondary` | verified seal, "Watchdog grounded", healthy services, valid chain |
| Warning, degraded | `tertiary` | DISCREPANCY, warning-band credibility, degraded state |
| Critical, threat, isolated, failed | `error` text, `error-container` at 30% tint, `error-strong` solid | threat verdicts, isolated agents, INVALID_ROW citations |
| Text | `on-surface`, `on-surface-variant`, `outline` | primary, secondary, disabled and tertiary text |
| Lines | `outline-variant` at 40% (border), 50% (hover) | cards, dividers |
| Control edge | `outline` at full strength (`CONTROL_BORDER` in `src/ui/classes.ts`) | text inputs, selects, switches: a control with no text of its own is found by its edge, so the edge must reach 3:1 (amendment 2026-10-11; `outline-variant` measures only 1.4 to 1.7:1 there) |
| Fills and glow | `primary-container` | glows, selection, scrollbar hover |

Gold is not reserved for the verdict. A state with no token maps to the nearest role, and it is flagged for review.

## 4. Status: colour plus shape (kept from v1)
Every status pairs its colour with a distinct glyph shape. Colour is never the only signal.

| Status | Colour | Glyph (Material Symbols) | Shape |
|---|---|---|---|
| Critical, threat, INVALID_ROW | `error` | `warning` | triangle |
| Warning, DISCREPANCY, degraded | `tertiary` | `error` (outlined) | circle |
| Safe, resolved, healthy | `secondary` | `check` | check |
| Verified against raw logs (VERIFIED) | `secondary` | `verified_user` | shield |
| Live or running | `primary` dot, `animate-pulse` | none | dot |
| Alert | `error` dot, `animate-ping` | none | dot |

## 5. Agent identity (visual only)
Names, domains and signals come from `/agents/fleet`. Glyph and colour come from `frontend/src/lib/agents.ts` and never change. Every place an agent is named shows its chip.

| Agent | Glyph | Chip colours |
|---|---|---|
| Network-Traffic | α | text and border `primary` #4cd7f6; fill `primary` at 10% |
| Access-Log | β | text and border `secondary` #4edea3; fill `secondary` at 10% |
| Endpoint-Behavior | γ | text and border `tertiary` #ffb95f; fill `tertiary` at 10% |
| Watchdog | Ω | text and border `primary-container` #06b6d4; fill `on-primary-container` #00424f |
| Self-Healing | Σ | text `error` #ffb4ab; border `error` at 40%; fill `error-container` at 30% |

Teal has no `@theme` token. The reference draws Ω with `secondary` text and a `primary` border on `on-primary-container`, and the approved plan says teal. This file maps teal to `primary-container`. Owner to confirm.

## 6. Typography
Three families, one job each. Never substitute.

| Role | Family | Size / line | Weight | Use |
|---|---|---|---|---|
| H1 | Space Grotesk | 30 / 36 (36 / 40 from `sm`), tracking-tight | 700 | page title |
| H2 | Space Grotesk | 18 / 28 | 700 | section and panel title |
| H3 | Space Grotesk | 16 / 24 | 600 | sub-heading |
| KPI number | Space Grotesk | 24 / 32, tabular-nums | 700 | every headline number |
| Body | Inter | 14 / 20 | 400 | UI text |
| Body large | Inter | 16 / 24 | 400 | lead sentences |
| Caption | Inter | 12 / 16 | 400 | helper and reason text |
| Label | Inter | 10 / 14, UPPERCASE, tracking 0.05em | 600 | section and column labels, nav items, status badge text |
| Evidence | JetBrains Mono | 12 / 16 (10 / 14 in dense tables) | 400–500 | every system value (below) |

- **Mono is for evidence only:** row ids, user and host ids, IPs, hashes, timestamps, raw field names and values, verdict class codes (`ddos`, `insider_file_exfiltration`), latencies, chain heads. Labels around them stay Inter.
- Sizes the reference uses outside this table (9, 11, 13, 15, 20, 22, 28, 48 and 60 px) map to the nearest row during the port. The large cases are the Overview H1 (36 px, then 48 px from `sm` and 60 px from `lg`) and one Debate Room figure (36 px, then 48 px from `sm`). They are listed for review.

## 7. Spacing, shape, layout
- **Spacing:** Tailwind default scale in 2px steps. The design uses 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 40, 48 and 64 px. Dense rows use 2, 6 and 10 px.
- **Radius:** 4px (`rounded`) badges, tags and evidence chips · 8px (`rounded-lg`) buttons, inputs, icon buttons and small tiles · 12px (`rounded-xl`) cards, panels and toasts · 16px (`rounded-2xl`) large feature panels · full (`rounded-full`) pills, dots, switches and progress tracks.
- **Card:** `surface-card`, border `outline-variant` at 40%, `rounded-xl`, `p-4`, `shadow-md`. Hover border takes the agent or status colour at 50%.
- **Panel:** `surface-container-low`, border `outline-variant` at 40%, `rounded-xl`.
- **Layout:** content `max-w-7xl` (1280px), centred. Gutters `px-4` (16px) below `lg`, `px-6` (24px) from `lg` (1024px). Sections `py-6`. 12-column grid from `lg`, `gap-4` (dense) or `gap-6` (between sections). No horizontal page scroll on phone widths.
- **Chrome:** top nav fixed, `h-16` below `lg` and `h-20` from `lg`. Footer `h-9`: chain status, thresholds, WebSocket state, latency.

## 8. Motifs
- **Top hairline:** a 2px strip (`h-0.5`) across the top edge of a screen's hero card, gradient `primary` → `secondary` → `tertiary`. Modals use a 4px strip (`h-1`), `primary` → `secondary` → `primary`. Not on every card.
- **Agent chips:** §5, everywhere an agent is named.
- **Credibility:** always a bar and a number together (`ProgressBar` with `Metric`). Track `surface-container-highest`, fill gradient `primary-container` → `secondary`, `rounded-full`. Below the isolation threshold, fill is `error` and the glyph is the critical triangle.
- **Verified seal:** `verified_user` at 12px in `secondary`, inline beside each VERIFIED citation. DISCREPANCY uses the warning circle. INVALID_ROW uses the critical triangle.
- **Glow:** only on active or live elements, never behind text.

## 9. Icons, charts, motion
- **Icons:** Material Symbols Outlined, a variable font loaded from Google Fonts. It replaces Lucide. The reference's `lucide-react` is unused and is not carried over. Sizes 12, 16 or 20 px only. Weight 400, FILL 0, GRAD 0. Subset to the icon names the app uses (plan §4, `icon_names`). Render through the `Icon` component, not raw spans.
- **Charts:** hand-written SVG. There is no Recharts (the reference has none). Components: Sparkline, TrajectoryChart, Ring, ProgressBar. Each takes real API data and has a Proof popover (§11). Series use `primary`, `secondary`, `tertiary` or `error`. Gridlines are `outline-variant` at 40%. Axis labels use the Label style.
- **Motion:** CSS only. `animate-in` is a real `@keyframes` in `tokens.css`: opacity 0 → 1 and translateY 4px → 0 over 200ms, ease-out. The reference's `animate-in` has no definition and does nothing. Every animation stops under `prefers-reduced-motion: reduce`. No motion library.

## 10. Implementation rules
- Tokens and globals live only in `frontend/src/styles/tokens.css`: `@theme`, body, scrollbar, glow and hero shadows, keyframes. No other file may contain a hex, `rgb(a)`, or arbitrary `[...]` colour, shadow or font value. The checker fails on raw hex outside that file.
- Use utility names: `bg-surface-card`, `text-on-surface-variant`, `border-outline-variant/40`, `shadow-glow-cyan`.
- Contrast: `pnpm check:contrast` (`frontend/scripts/contrast-check.mjs`, Node built-ins only) reads `tokens.css`, measures every text, accent and filled-button pair the console uses (WCAG 4.5:1) and the edge of every control with no text of its own (3:1), and fails the build below those. Card and panel borders, surface steps and the borders of labelled buttons are listed with their ratio but are decorative: they keep the reference's values (exact ditto). The result is in `docs/fidelity/contrast.md`.
- Chrome: body `background` with `on-surface` text, Inter, `overscroll-behavior: none`. Selection `primary-container` on `on-primary`. Scrollbar 5px: track `surface`, thumb `surface-container-high`, hover `primary-container`.
- Fonts load once in `index.html`: Inter 300–700, JetBrains Mono 400–700, Space Grotesk 500–700, Material Symbols Outlined.
- Not carried over from the reference's `package.json`, because they are outside the locked stack: `lucide-react`, `motion`, `@google/genai`, `express`, `dotenv`.
- No `dangerouslySetInnerHTML`. Log text is untrusted.
- The `.cyber-grid` class (32px grid, `primary` at 3.5%) is defined in the reference, and no screen uses it. It is optional. The Overview hero uses a different texture: a 28px dot grid (`primary` 1px dots on a transparent field, layer at 20% opacity). If the Overview is ported, define that texture once as a class in `tokens.css`.
- Reference colour classes that are not in §2 map to tokens during the port. `#869296` (25 uses, one step off `outline` #869397) maps to `outline`. `#c084fc` (purple) is used only by the dropped Epsilon avatar and by the Access Console's Agent Fleet tile (icon and hover text). It is not carried over. The tile takes the nearest role from §3 and is listed for review.

## 11. No-bluff rules (summary; the contract is plan §1)
- **R1 and R5:** every value, label, chart point, row and status is an API field, or a browser function of API fields whose formula and inputs show in its Proof popover. Nothing is typed into components. Every metric and control has a Proof popover.
- **R2:** live numbers use the `Metric` envelope. A null value renders "—" with its reason. Never 0 for missing data. A real 0 renders as 0.
- **R3 and R4:** rates and averages need n ≥ 1, with n visible in Proof. Model confidence is labelled "agent-reported". Accuracy comes only from `/evaluation`. Brier comes only from analyst feedback and is null until feedback exists.
- **R6 and R7:** no claim without a mechanism (no RFC, Merkle, Ed25519, eBPF, container isolation, literature statistics, or "zero-trust"). Only real project entities.
- **R8 and R9:** every control is a real, RBAC-gated, audited action, or it is removed. The blind test is a checked property, and the UI links to its test.
- **R10:** `frontend/scripts/no-bluff-check.mjs` fails the build on raw hex outside tokens, `mockData`, `Math.random`, `dangerouslySetInnerHTML`, `fetch(` outside `src/api/`, imports from `src/data/`, and the blacklist in plan §7. The backend contract test (`tests/contract/test_no_bluff_contract.py`) and the Playwright canary cover the rest: null metrics on an empty DB, and seeded API values verbatim in the DOM.

## 11b. Printed documents (added 2026-10-11, owner's request)
The case report (`#/report/<id>`) and the chain-of-custody record (`#/custody/<id>`) are A4 documents. They are routed outside the console shell (no sidebar, top bar or footer), print through the browser's own dialog (Save as PDF; no PDF library, the stack is locked) and are tested to print to a real PDF with Chromium.
- **Paper tokens** (in `tokens.css`, the only place for colour values): `paper` (the white page), `paper-tint` (panels and zebra rows), `paper-rule` (lines), `ink` and `ink-muted` (text), and a deeper shade of each accent for white: `paper-primary`, `paper-secondary`, `paper-tertiary`, `paper-error`. The neon accents of §2 are for the dark console only. Every pair used (ink and the four accents on the page and on the tint) is in the contrast check (4.5:1).
- **Structure:** a dark cover band (`surface` with the brand and the verdict at a glance, the gradient hairline of §8), then light sections: an uppercase section title with an accent bar, facts, tables with a tinted header row, chips in the Label style, one timeline bar. Headings keep with the block after them, rows and cards do not split across pages.
- **Page:** `@page report { size: A4; margin: 12mm }`, `color-scheme: light` in print, `print-color-adjust: exact` on the sheet. The toolbar above the sheet is `print:hidden`.
- **Fonts:** the same three families as the console; the PDF carries what the browser had loaded.
- **Content rule:** the same no-bluff contract: every sentence is a template over API fields (the summary is written from the case's own fields, not by a model), every figure is an API field or a derivation named in its section, a missing part says so, and nothing claims a signature the project does not have.

## 12. Superseded v1 rules (removed)
- Token table (#0A0A0F, #14141F, #1E1E2E, #2E2E42, violet #8B5CF6, gold #F0B429, #F04438, #F79009, #12B76A, #36BFFA, white at 100/70/40%) → §2.
- "Violet = AI reasoning; gold = verdict only" → §3.
- "No drop shadows; elevation by lightness only" → glow, panel and hero tokens (§2). Lightness steps still apply to surfaces.
- "Lucide only, consistent stroke width" → Material Symbols (§9).
- Mono on nav items, footer labels and status badges (reference) → Inter labels. Mono stays for evidence values only (§6).
- "Spacing only 4/8/16/24/32/48/64" → 2px-step scale (§7).
- "10px radius for cards, inputs and buttons" → 12px cards, 8px inputs and buttons (§7).
- "1px violet-to-transparent hairline" → 2px `primary`/`secondary`/`tertiary` hairline (§8).
- "Agent monograms NT, AL, EB, WD, SH" → Greek glyphs α, β, γ, Ω, Σ (§5).
- "Max width 1440px, 24px gutters" → `max-w-7xl` (1280px), gutters 16 and 24px (§7).
- "H1 32/40, H2 22/30, H3 17/24, Label 11/14 at 0.4px" → §6.
- "Verified seal: gold or info-blue shield" → `secondary` shield (§8).
- "Wire up the Figma Make code; reuse its components; no parallel system" → port the reference onto the real API (CLAUDE.md, plan §4).

Kept from v1: Space Grotesk for headings, Inter for body and labels, JetBrains Mono for evidence, status colour plus shape, credibility bar with number, agent chips, verified seal, and no hard-coded values.
