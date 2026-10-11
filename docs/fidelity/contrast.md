# Contrast of the design tokens (2026-10-11)

Measured by `frontend/scripts/contrast-check.mjs` (`pnpm check:contrast`), which reads the colours from
`frontend/src/styles/tokens.css` and applies the WCAG 2.x formula. It runs in CI.

**What the console must meet.** Text 4.5 : 1. The edge of a control that has no text of its own (a text input, a select,
a switch) 3 : 1, because that edge is how a reader finds it. **What it need not meet.** Card and panel borders, surface
steps and the border of a labelled button or a Proof circle are decorative: the label or icon identifies the control,
so WCAG does not ask for 3 : 1 there. They are listed for information.

## Result

- **Text: all 58 pairs pass** (46 for the console, 12 for the printed documents' paper and ink). The tightest is `on-secondary-container` on `secondary-container` at 4.54 : 1; every
  body and caption pair on every surface is above 5.4 : 1.
- **Controls: one finding, fixed.** Inputs, selects and switches drew their edge with `outline-variant` at 60 %, which is
  1.4 to 1.7 : 1 against the page and the cards. They now use `CONTROL_BORDER` (`outline`, 5.4 to 6.6 : 1), one
  constant in `src/ui/classes.ts`; unit tests keep the controls on it.
- **Decorative lines keep the reference's values.** Card borders (1.2 to 1.6 : 1) and surface steps (1.05 to 1.23 : 1)
  are the reference design's own look; the exact-ditto directive (UD16) keeps them. They are exceptions, listed below,
  not failures.

## All pairs
| Kind | Pair | Ratio | Needs | Result |
|---|---|---|---|---|
| text | on-surface on background | 16.24 : 1 | 4.50 : 1 | pass |
| text | on-surface-variant on background | 12.37 : 1 | 4.50 : 1 | pass |
| text | on-surface on surface-container-lowest | 15.33 : 1 | 4.50 : 1 | pass |
| text | on-surface-variant on surface-container-lowest | 11.68 : 1 | 4.50 : 1 | pass |
| text | on-surface on surface | 14.38 : 1 | 4.50 : 1 | pass |
| text | on-surface-variant on surface | 10.96 : 1 | 4.50 : 1 | pass |
| text | on-surface on surface-container-low | 13.88 : 1 | 4.50 : 1 | pass |
| text | on-surface-variant on surface-container-low | 10.58 : 1 | 4.50 : 1 | pass |
| text | on-surface on surface-card | 13.21 : 1 | 4.50 : 1 | pass |
| text | on-surface-variant on surface-card | 10.07 : 1 | 4.50 : 1 | pass |
| text | on-surface on surface-container | 12.63 : 1 | 4.50 : 1 | pass |
| text | on-surface-variant on surface-container | 9.63 : 1 | 4.50 : 1 | pass |
| text | on-surface on surface-container-high | 11.13 : 1 | 4.50 : 1 | pass |
| text | on-surface-variant on surface-container-high | 8.48 : 1 | 4.50 : 1 | pass |
| text | outline (muted caption text) on background | 6.63 : 1 | 4.50 : 1 | pass |
| text | outline (muted caption text) on surface-card | 5.40 : 1 | 4.50 : 1 | pass |
| text | outline (muted caption text) on surface-container-low | 5.67 : 1 | 4.50 : 1 | pass |
| text | primary on background | 12.36 : 1 | 4.50 : 1 | pass |
| text | primary on surface-card | 10.05 : 1 | 4.50 : 1 | pass |
| text | primary on surface-container-low | 10.56 : 1 | 4.50 : 1 | pass |
| text | primary on surface-container-high | 8.47 : 1 | 4.50 : 1 | pass |
| text | secondary on background | 12.30 : 1 | 4.50 : 1 | pass |
| text | secondary on surface-card | 10.01 : 1 | 4.50 : 1 | pass |
| text | secondary on surface-container-low | 10.51 : 1 | 4.50 : 1 | pass |
| text | secondary on surface-container-high | 8.43 : 1 | 4.50 : 1 | pass |
| text | tertiary on background | 12.36 : 1 | 4.50 : 1 | pass |
| text | tertiary on surface-card | 10.05 : 1 | 4.50 : 1 | pass |
| text | tertiary on surface-container-low | 10.56 : 1 | 4.50 : 1 | pass |
| text | tertiary on surface-container-high | 8.47 : 1 | 4.50 : 1 | pass |
| text | error on background | 12.37 : 1 | 4.50 : 1 | pass |
| text | error on surface-card | 10.06 : 1 | 4.50 : 1 | pass |
| text | error on surface-container-low | 10.57 : 1 | 4.50 : 1 | pass |
| text | error on surface-container-high | 8.47 : 1 | 4.50 : 1 | pass |
| text | primary-fixed on background | 16.31 : 1 | 4.50 : 1 | pass |
| text | primary-fixed on surface-card | 13.27 : 1 | 4.50 : 1 | pass |
| text | on-primary on primary-container (primary button) | 5.40 : 1 | 4.50 : 1 | pass |
| text | on-primary on primary (primary button, hover) | 7.72 : 1 | 4.50 : 1 | pass |
| text | on-secondary on secondary | 7.73 : 1 | 4.50 : 1 | pass |
| text | on-secondary-container on secondary-container | 4.54 : 1 | 4.50 : 1 | pass |
| text | on-tertiary on tertiary-container | 5.40 : 1 | 4.50 : 1 | pass |
| text | on-error-container on error-container | 7.24 : 1 | 4.50 : 1 | pass |
| text | on-error on error | 7.72 : 1 | 4.50 : 1 | pass |
| text | primary on a 15% primary tint over surface-card (pill) | 7.23 : 1 | 4.50 : 1 | pass |
| text | secondary on a 15% secondary tint over surface-card (pill) | 7.24 : 1 | 4.50 : 1 | pass |
| text | tertiary on a 15% tertiary tint over surface-card (pill) | 7.21 : 1 | 4.50 : 1 | pass |
| text | error on a 30% error-container tint over surface-card (pill) | 9.40 : 1 | 4.50 : 1 | pass |
| text | ink on paper | 18.72 : 1 | 4.50 : 1 | pass |
| text | ink-muted on paper | 7.53 : 1 | 4.50 : 1 | pass |
| text | paper-primary on paper | 5.36 : 1 | 4.50 : 1 | pass |
| text | paper-secondary on paper | 5.48 : 1 | 4.50 : 1 | pass |
| text | paper-tertiary on paper | 5.02 : 1 | 4.50 : 1 | pass |
| text | paper-error on paper | 6.47 : 1 | 4.50 : 1 | pass |
| text | ink on paper-tint | 17.26 : 1 | 4.50 : 1 | pass |
| text | ink-muted on paper-tint | 6.94 : 1 | 4.50 : 1 | pass |
| text | paper-primary on paper-tint | 4.94 : 1 | 4.50 : 1 | pass |
| text | paper-secondary on paper-tint | 5.06 : 1 | 4.50 : 1 | pass |
| text | paper-tertiary on paper-tint | 4.63 : 1 | 4.50 : 1 | pass |
| text | paper-error on paper-tint | 5.97 : 1 | 4.50 : 1 | pass |
| control | input, select and switch border (outline) against background | 6.63 : 1 | 3.00 : 1 | pass |
| control | input, select and switch border (outline) against surface-card | 5.40 : 1 | 3.00 : 1 | pass |
| control | input, select and switch border (outline) against surface-container-low | 5.67 : 1 | 3.00 : 1 | pass |
| control | focus ring (primary) against background | 12.36 : 1 | 3.00 : 1 | pass |
| control | selected tab line (primary) against background | 12.36 : 1 | 3.00 : 1 | pass |
| decorative | button border (outline-variant at 60%) against background | 1.89 : 1 | none | info |
| decorative | button border (outline-variant at 60%) against surface-card | 1.54 : 1 | none | info |
| decorative | button border (outline-variant at 60%) against surface-container-low | 1.62 : 1 | none | info |
| decorative | card border (outline-variant at 30%) against background | 1.44 : 1 | none | info |
| decorative | card border (outline-variant at 30%) against surface-card | 1.17 : 1 | none | info |
| decorative | card border (outline-variant at 40%) against background | 1.52 : 1 | none | info |
| decorative | card border (outline-variant at 40%) against surface-card | 1.24 : 1 | none | info |
| decorative | card border (outline-variant at 50%) against background | 1.63 : 1 | none | info |
| decorative | card border (outline-variant at 50%) against surface-card | 1.33 : 1 | none | info |
| decorative | surface step surface-card against background | 1.23 : 1 | none | info |
| decorative | surface step surface-container-low against background | 1.17 : 1 | none | info |
| decorative | surface step surface-container against surface-card | 1.05 : 1 | none | info |
| decorative | surface step surface-container-high against surface-container | 1.14 : 1 | none | info |
