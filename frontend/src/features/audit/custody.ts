/** Export of the custody bundle (entries and chain head) as a JSON file. */
import { describeError } from '../../api/client';
import type { AuditTrailResponse } from '../../api/types';
import { formatCountNoun } from '../../lib/format';
import { pushToast } from '../../ui/toast-store';

export function exportCustodyBundle(data: AuditTrailResponse): void {
  const headHash = data.entries[0]?.entry_hash ?? null;
  const bundle = {
    exported_at: new Date().toISOString(),
    chain: data.chain,
    head_hash: headHash,
    entries: data.entries,
  };
  try {
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `verdictchain-audit-${data.chain.head_seq ?? 'head'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    pushToast(`Exported ${formatCountNoun(data.entries.length, 'audit entry', 'audit entries')} with head hash.`, { tone: 'secondary' });
  } catch (cause) {
    pushToast(describeError(cause), { tone: 'error' });
  }
}
