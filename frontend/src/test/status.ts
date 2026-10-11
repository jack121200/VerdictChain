/**
 * A status colour is never the only signal: each status word has a glyph of its own beside it (SKILL-design-system
 * section 4, checklist FM4). glyphBeside() returns the Material Symbols name rendered inside the element that
 * holds the word (a Pill, a badge), or null when there is none, so a test can assert it is not null.
 */
export function glyphBeside(word: HTMLElement): string | null {
  return word.querySelector('.vc-icon')?.textContent ?? null;
}
