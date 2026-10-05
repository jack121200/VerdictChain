/**
 * Browser-side hash checks (plan 1 R5). Audit entries are verified over the server's exact
 * hash_input string. Evidence bundles are verified over canonical JSON.
 */

/** SHA-256 of the UTF-8 bytes of text, as lowercase hex. Needs WebCrypto (a secure context). */
export async function sha256Hex(text: string): Promise<string> {
  const subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      'SHA-256 needs WebCrypto (crypto.subtle), which this page does not have. Open the console at http://localhost or over https.',
    );
  }
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * JSON string literal with non-ASCII escaped as \uXXXX, matching Python json.dumps (ensure_ascii).
 * ensure_ascii escapes U+0080 and above only, so DEL (U+007F) stays literal.
 */
function encodeString(value: string): string {
  return JSON.stringify(value).replace(/[\u0080-￿]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * Number text as Python's repr writes it. Exponent form for magnitudes below 1e-4 and at
 * or above 1e16. Caveat: Python writes integral floats as "1.0" and JS cannot tell them apart
 * from ints, so the server must hash integral floats the same way (see the W0-B report).
 */
function encodeNumber(value: number): string {
  if (!Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
  if (Number.isInteger(value) && Math.abs(value) < 1e16) return String(value);
  const [mantissa, exponentText] = value.toExponential().split('e');
  const exponent = Number(exponentText);
  if (exponent < -4 || exponent >= 16) {
    const sign = exponent < 0 ? '-' : '+';
    return `${mantissa}e${sign}${String(Math.abs(exponent)).padStart(2, '0')}`;
  }
  return String(value);
}

/**
 * Canonical JSON: sorted keys, compact separators, ASCII escapes. This is the form the
 * evidence bundle hash is taken over (plan 3.4).
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return encodeNumber(value);
  if (typeof value === 'string') return encodeString(value);
  if (Array.isArray(value)) return `[${value.map((item: unknown) => canonicalJson(item ?? null)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const members = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${encodeString(key)}:${canonicalJson(record[key])}`);
    return `{${members.join(',')}}`;
  }
  throw new TypeError(`canonicalJson: unsupported value of type ${typeof value}`);
}

/** Recomputes an audit entry's hash from its hash_input and compares it with entry_hash. */
export async function verifyAuditEntryHash(entry: { hash_input: string; entry_hash: string }): Promise<boolean> {
  return (await sha256Hex(entry.hash_input)) === entry.entry_hash.toLowerCase();
}

/** Recomputes an evidence bundle's hash over canonical JSON and compares it with bundle_sha256. */
export async function verifyEvidenceBundleHash(bundle: unknown, bundleSha256: string): Promise<boolean> {
  return (await sha256Hex(canonicalJson(bundle))) === bundleSha256.toLowerCase();
}
