import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../lib/derive/hash';
import { caseChainFixture } from '../../test/case-chain';
import { recomputeCaseChain } from './case-chain';

const THREE = [
  { seq: 11, action: 'investigation_started' },
  { seq: 14, action: 'round_completed' },
  { seq: 19, action: 'verdict_reached' },
] as const;

describe('recomputeCaseChain', () => {
  it('finds every entry and the digest equal to what the server sent', async () => {
    const chain = await caseChainFixture(THREE);

    const check = await recomputeCaseChain(chain);

    expect(check).toMatchObject({ matching: 3, total: 3, mismatched: [], digestMatches: true });
    expect(check.digest).toBe(chain.case_digest);
  });

  it('computes the digest by the published rule: entry hashes, oldest first, joined by a newline', async () => {
    const chain = await caseChainFixture(THREE);

    const check = await recomputeCaseChain(chain);

    expect(check.digest).toBe(await sha256Hex(chain.entries.map((entry) => entry.entry_hash).join('\n')));
    // A different order is a different digest, so the order matters and is the server's.
    const reversed = await sha256Hex([...chain.entries].reverse().map((entry) => entry.entry_hash).join('\n'));
    expect(reversed).not.toBe(check.digest);
  });

  it('names the entry whose text no longer hashes to its stored hash, and the digest still matches that stored hash', async () => {
    const chain = await caseChainFixture(THREE);
    chain.entries[1] = { ...chain.entries[1], hash_input: chain.entries[1].hash_input.replace('round_completed', 'round_completed_edited') };

    const check = await recomputeCaseChain(chain);

    expect(check).toMatchObject({ matching: 2, total: 3, mismatched: [14] });
    expect(check.digestMatches).toBe(true); // the digest is over the stored hashes, which were not touched
  });

  it('finds a digest that is not the digest of the entries', async () => {
    const chain = await caseChainFixture(THREE);

    const check = await recomputeCaseChain({ ...chain, case_digest: 'f'.repeat(64) });

    expect(check.digestMatches).toBe(false);
    expect(check.mismatched).toEqual([]);
  });

  it('finds a digest after an entry hash was swapped', async () => {
    const chain = await caseChainFixture(THREE);
    chain.entries[2] = { ...chain.entries[2], entry_hash: 'a'.repeat(64) };

    const check = await recomputeCaseChain(chain);

    expect(check.mismatched).toEqual([19]); // its text no longer hashes to the stored value
    expect(check.digestMatches).toBe(false); // and the digest over the stored hashes no longer matches the server's
  });

  it('has nothing to check for a case without entries, and says so with null, not a pass', async () => {
    const chain = await caseChainFixture([]);

    const check = await recomputeCaseChain(chain);

    expect(check).toEqual({ matching: 0, total: 0, mismatched: [], digest: null, digestMatches: null });
  });

  it('compares hex case-insensitively', async () => {
    const chain = await caseChainFixture(THREE);
    chain.case_digest = (chain.case_digest ?? '').toUpperCase();
    chain.entries[0] = { ...chain.entries[0], entry_hash: chain.entries[0].entry_hash.toUpperCase() };

    const check = await recomputeCaseChain(chain);

    expect(check.mismatched).toEqual([]);
  });
});
