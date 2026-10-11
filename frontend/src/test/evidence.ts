/**
 * Evidence is shown in the evidence font (JetBrains Mono, class font-mono): ids, hashes and fingerprints are read
 * character by character, and a proportional font hides the difference between an l and a 1 (checklist FM3).
 * evidenceOutsideMono() lists every text that looks like one and is NOT inside a font-mono element, so a page test
 * can assert the list is empty.
 */
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const LONG_HEX = /\b[0-9a-f]{16,}\b/i; // SHA-256 digests, row fingerprints, audit hashes
const SHORT_ID = /^[0-9a-f]{8}$/i; // the 8-character form of a case id (shortId)

export function evidenceOutsideMono(root: HTMLElement): string[] {
  const offenders: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = (walker.currentNode.textContent ?? '').trim();
    if (text === '' || !(UUID.test(text) || LONG_HEX.test(text) || SHORT_ID.test(text))) continue;
    const parent = walker.currentNode.parentElement;
    if (parent === null || parent.closest('script, style, title')) continue;
    if (parent.closest('.font-mono') === null) offenders.push(text.slice(0, 70));
  }
  return offenders;
}
