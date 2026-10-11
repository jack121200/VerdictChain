#!/usr/bin/env node
/**
 * Contrast check (WCAG 2.x) of the real design tokens. Reads src/styles/tokens.css, the only file that holds raw
 * colours, and computes the contrast ratio of every pair the console actually uses:
 *
 *   text          4.5 : 1  body and caption text on the surface it sits on
 *   control       3.0 : 1  the boundary of an interactive control (input, select, toggle, tab line) against what is
 *                          around it (WCAG 1.4.11 non-text contrast)
 *   decorative    info     card and panel borders. WCAG does not require these (they are not needed to find or use
 *                          anything), so they are listed with their ratio and never fail the check.
 *
 * Usage: node scripts/contrast-check.mjs          prints the table, exits 1 if a text or control pair fails
 *        node scripts/contrast-check.mjs --md     prints the table as Markdown (docs/fidelity/contrast.md)
 *
 * Node built-ins only. Alpha is composited over the background the way the browser does it (sRGB, straight alpha).
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '..', 'src', 'styles', 'tokens.css'), 'utf8');

/** token name (without --color-) -> [r, g, b] */
const tokens = new Map();
for (const match of css.matchAll(/--color-([a-z0-9-]+):\s*#([0-9a-fA-F]{6})\s*;/g)) {
  const hex = match[2];
  tokens.set(match[1], [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)));
}

function rgb(name) {
  const value = tokens.get(name);
  if (!value) throw new Error(`token --color-${name} is not in tokens.css`);
  return value;
}

/** a colour at `alpha` over `base` (both [r,g,b]) */
function over(color, alpha, base) {
  return color.map((channel, index) => Math.round(alpha * channel + (1 - alpha) * base[index]));
}

function luminance([r, g, b]) {
  const lin = (value) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ['background', 'surface-container-lowest', 'surface', 'surface-container-low', 'surface-card', 'surface-container', 'surface-container-high'];
const ACCENT_TEXT = ['primary', 'secondary', 'tertiary', 'error'];

const pairs = [];
const add = (kind, label, fg, bg, minimum) => pairs.push({ kind, label, fg, bg, minimum });

for (const bg of SURFACES) {
  add('text', `on-surface on ${bg}`, rgb('on-surface'), rgb(bg), 4.5);
  add('text', `on-surface-variant on ${bg}`, rgb('on-surface-variant'), rgb(bg), 4.5);
}
for (const bg of ['background', 'surface-card', 'surface-container-low']) {
  add('text', `outline (muted caption text) on ${bg}`, rgb('outline'), rgb(bg), 4.5);
}
for (const accent of ACCENT_TEXT) {
  for (const bg of ['background', 'surface-card', 'surface-container-low', 'surface-container-high']) {
    add('text', `${accent} on ${bg}`, rgb(accent), rgb(bg), 4.5);
  }
}
add('text', 'primary-fixed on background', rgb('primary-fixed'), rgb('background'), 4.5);
add('text', 'primary-fixed on surface-card', rgb('primary-fixed'), rgb('surface-card'), 4.5);
// Filled buttons and chips: their own "on" colours.
add('text', 'on-primary on primary-container (primary button)', rgb('on-primary'), rgb('primary-container'), 4.5);
add('text', 'on-primary on primary (primary button, hover)', rgb('on-primary'), rgb('primary'), 4.5);
add('text', 'on-secondary on secondary', rgb('on-secondary'), rgb('secondary'), 4.5);
add('text', 'on-secondary-container on secondary-container', rgb('on-secondary-container'), rgb('secondary-container'), 4.5);
add('text', 'on-tertiary on tertiary-container', rgb('on-tertiary'), rgb('tertiary-container'), 4.5);
add('text', 'on-error-container on error-container', rgb('on-error-container'), rgb('error-container'), 4.5);
add('text', 'on-error on error', rgb('on-error'), rgb('error'), 4.5);
// Tinted pills: an accent text on a translucent accent background over a card.
const card = rgb('surface-card');
for (const accent of ACCENT_TEXT) {
  const container = accent === 'error' ? rgb('error-container') : rgb(accent);
  const alpha = accent === 'error' ? 0.3 : 0.15;
  add('text', `${accent} on a ${Math.round(alpha * 100)}% ${accent === 'error' ? 'error-container' : accent} tint over surface-card (pill)`, rgb(accent), over(container, alpha, card), 4.5);
}

// The printed documents (case report, chain of custody): ink and the deeper accents on the white page and on its tint.
for (const bg of ['paper', 'paper-tint']) {
  add('text', `ink on ${bg}`, rgb('ink'), rgb(bg), 4.5);
  add('text', `ink-muted on ${bg}`, rgb('ink-muted'), rgb(bg), 4.5);
  for (const accent of ['paper-primary', 'paper-secondary', 'paper-tertiary', 'paper-error']) {
    add('text', `${accent} on ${bg}`, rgb(accent), rgb(bg), 4.5);
  }
}

// Control boundaries: a control with no text label of its own (a text input, a select, a switch) is found by its
// edge, so the edge must reach 3:1 against the surface around it. The shared CONTROL_BORDER (src/ui/classes.ts)
// is the `outline` token at full strength.
for (const around of ['background', 'surface-card', 'surface-container-low']) {
  add('control', `input, select and switch border (outline) against ${around}`, rgb('outline'), rgb(around), 3);
}
add('control', 'focus ring (primary) against background', rgb('primary'), rgb('background'), 3);
add('control', 'selected tab line (primary) against background', rgb('primary'), rgb('background'), 3);

// Decorative: a button or a Proof circle is identified by its label or icon, not by its edge, and a card or panel
// border only tidies the layout. WCAG does not require these, so they are listed for information.
for (const around of ['background', 'surface-card', 'surface-container-low']) {
  add('decorative', `button border (outline-variant at 60%) against ${around}`, over(rgb('outline-variant'), 0.6, rgb('surface-container-high')), rgb(around), 0);
}
for (const alpha of [0.3, 0.4, 0.5]) {
  for (const around of ['background', 'surface-card']) {
    const inside = rgb('surface-card');
    add('decorative', `card border (outline-variant at ${Math.round(alpha * 100)}%) against ${around}`, over(rgb('outline-variant'), alpha, inside), rgb(around), 0);
  }
}
for (const [a, b] of [['surface-card', 'background'], ['surface-container-low', 'background'], ['surface-container', 'surface-card'], ['surface-container-high', 'surface-container']]) {
  add('decorative', `surface step ${a} against ${b}`, rgb(a), rgb(b), 0);
}

const rows = pairs.map((pair) => {
  const value = ratio(pair.fg, pair.bg);
  const status = pair.minimum === 0 ? 'info' : value >= pair.minimum ? 'pass' : 'FAIL';
  return { ...pair, value, status };
});

const markdown = process.argv.includes('--md');
const format = (value) => `${value.toFixed(2)} : 1`;
if (markdown) {
  console.log('| Kind | Pair | Ratio | Needs | Result |');
  console.log('|---|---|---|---|---|');
  for (const row of rows) console.log(`| ${row.kind} | ${row.label} | ${format(row.value)} | ${row.minimum === 0 ? 'none' : format(row.minimum)} | ${row.status} |`);
} else {
  for (const row of rows) console.log(`${row.status.padEnd(4)} ${row.kind.padEnd(10)} ${format(row.value).padStart(9)}  ${row.label}`);
}

const failing = rows.filter((row) => row.status === 'FAIL');
const required = rows.filter((row) => row.minimum > 0).length;
console.error(
  `\ncheck:contrast ${failing.length === 0 ? 'OK' : 'FAILED'}: ${required} required pairs, ${failing.length} below their minimum, ${rows.length - required} decorative pairs listed.`,
);
if (failing.length > 0) {
  for (const row of failing) console.error(`  FAIL ${row.label}: ${format(row.value)} (needs ${format(row.minimum)})`);
  process.exit(1);
}
