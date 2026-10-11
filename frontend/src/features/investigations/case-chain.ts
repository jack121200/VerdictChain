import type { CaseAuditChain } from '../../api/types';
import { sha256Hex } from '../../lib/derive/hash';

export interface CaseChainCheck {
  /** Entries whose hash the browser recomputed from hash_input and found equal to entry_hash. */
  matching: number;
  total: number;
  /** The seq of every entry whose recomputed hash differs from its stored one. */
  mismatched: number[];
  /** The case digest the browser computed (null when the case has no entries). */
  digest: string | null;
  /** Equal to the server's digest? null when there is nothing to compare (no entries). */
  digestMatches: boolean | null;
}

/**
 * Recomputes, in the browser, everything the server claims about one case: the SHA-256 of every entry over its
 * hash_input, and the case digest (SHA-256 of the entry hashes, oldest first, joined by a newline, the rule the
 * server publishes as digest_rule). Two independent implementations (Python on the server, WebCrypto here) must
 * agree, which is the point of showing the result.
 */
export async function recomputeCaseChain(chain: CaseAuditChain): Promise<CaseChainCheck> {
  const mismatched: number[] = [];
  for (const entry of chain.entries) {
    const computed = await sha256Hex(entry.hash_input);
    if (computed !== entry.entry_hash.toLowerCase()) mismatched.push(entry.seq);
  }
  const digest = chain.entries.length === 0 ? null : await sha256Hex(chain.entries.map((entry) => entry.entry_hash).join('\n'));
  return {
    matching: chain.entries.length - mismatched.length,
    total: chain.entries.length,
    mismatched,
    digest,
    digestMatches: digest === null ? null : digest === (chain.case_digest ?? '').toLowerCase(),
  };
}
