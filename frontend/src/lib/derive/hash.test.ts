import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalJson, sha256Hex, verifyAuditEntryHash, verifyEvidenceBundleHash } from './hash';

const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

describe('sha256Hex', () => {
  it('matches the known digest of a short string', async () => {
    expect(await sha256Hex('abc')).toBe(ABC_SHA256);
  });

  it('fails with a clear message when WebCrypto is unavailable', async () => {
    vi.stubGlobal('crypto', undefined);
    await expect(sha256Hex('abc')).rejects.toThrow(/WebCrypto/);
    vi.unstubAllGlobals();
  });
});

describe('canonicalJson', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sorts keys and uses compact separators', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x'] })).toBe('{"a":[true,null,"x"],"b":1}');
  });

  it('escapes non-ASCII the way Python json.dumps does, and keeps DEL literal', () => {
    expect(canonicalJson('é')).toBe('"\\u00e9"');
    expect(canonicalJson('\u007f')).toBe('"\u007f"');
  });

  it('writes numbers the way Python repr does', () => {
    expect(canonicalJson(3)).toBe('3');
    expect(canonicalJson(0.5)).toBe('0.5');
    expect(canonicalJson(0.00001)).toBe('1e-05');
    expect(canonicalJson(1e16)).toBe('1e+16');
  });

  it('drops undefined object members and rejects non-finite numbers', () => {
    expect(canonicalJson({ a: undefined, b: 2 })).toBe('{"b":2}');
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
  });
});

describe('hash checks', () => {
  it('verifies an audit entry against its hash_input, case-insensitively', async () => {
    expect(await verifyAuditEntryHash({ hash_input: 'abc', entry_hash: ABC_SHA256.toUpperCase() })).toBe(true);
    expect(await verifyAuditEntryHash({ hash_input: 'abd', entry_hash: ABC_SHA256 })).toBe(false);
  });

  it('verifies an evidence bundle over its canonical JSON', async () => {
    const bundle = { z: 1, a: 'x' };
    const digest = await sha256Hex('{"a":"x","z":1}');
    expect(await verifyEvidenceBundleHash(bundle, digest)).toBe(true);
    expect(await verifyEvidenceBundleHash(bundle, ABC_SHA256)).toBe(false);
  });
});
