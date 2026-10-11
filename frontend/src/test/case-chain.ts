/**
 * A consistent GET /investigations/{id}/audit-chain payload for tests: every entry's entry_hash really is the SHA-256 of
 * its hash_input, and case_digest really is the digest of the entry hashes (the same rule the server publishes).
 */
import type { AuditAction, CaseAuditChain, CaseAuditEntry, CaseLink } from '../api/types';
import { sha256Hex } from '../lib/derive/hash';
import { metric } from './fixtures';

export interface EntrySpec {
  seq: number;
  action: AuditAction;
  links_to?: CaseLink;
}

export async function caseChainFixture(
  specs: readonly EntrySpec[],
  investigationId = 'inv-1',
  globalTotal = specs.length,
): Promise<CaseAuditChain> {
  const entries: CaseAuditEntry[] = [];
  let previous: string | null = null;
  for (const spec of specs) {
    const hashInput: string = `debate_engine|${spec.action}|{}|${previous ?? ''}`;
    const entryHash: string = await sha256Hex(hashInput);
    entries.push({
      seq: spec.seq,
      prev_hash: previous,
      entry_hash: entryHash,
      hash_input: hashInput,
      actor: 'debate_engine',
      action: spec.action,
      detail: {},
      investigation_id: investigationId,
      created_at: '2026-10-11T00:00:00Z',
      links_to: spec.links_to ?? (previous === null ? 'genesis' : 'case'),
    });
    previous = entryHash;
  }
  const digest = entries.length === 0 ? null : await sha256Hex(entries.map((entry) => entry.entry_hash).join('\n'));
  return {
    investigation_id: investigationId,
    entries,
    count: metric(entries.length),
    case_digest: digest,
    digest_rule: 'SHA-256 of the entry_hash values of this case’s entries, oldest first, joined by a newline (no trailing newline).',
    chain: { valid: true, head_seq: entries.length === 0 ? null : entries[entries.length - 1].seq, total: globalTotal },
  };
}
