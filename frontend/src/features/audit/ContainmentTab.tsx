/** The containment tab of the Audit screen: every response action with its is_simulated flag. */
import { listResponseActions } from '../../api/client';
import type { ResponseAction } from '../../api/types';
import { useAsync } from '../../app/use-async';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { Proof } from '../../ui/Proof';
import { Table, type TableColumn } from '../../ui/Table';
import { Timestamp } from '../../ui/Timestamp';

export const CONTAINMENT_COLUMNS: readonly TableColumn<ResponseAction>[] = [
  { key: 'action', header: 'Action', cell: (row) => row.action_type, mono: true },
  { key: 'target', header: 'Target', cell: (row) => row.target, mono: true },
  { key: 'reason', header: 'Reason', cell: (row) => row.reason ?? '—' },
  {
    key: 'simulated',
    header: 'Mode',
    cell: (row) =>
      row.is_simulated ? (
        <span className="inline-flex items-center gap-1 font-mono text-[11px] font-bold text-secondary">
          <Icon name="check" size={12} /> Simulated
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 font-mono text-[11px] font-bold text-error">
          <Icon name="warning" size={12} /> Not simulated
        </span>
      ),
  },
  { key: 'when', header: 'Recorded', cell: (row) => <Timestamp iso={row.created_at} />, mono: true },
];

export function ContainmentTab() {
  const actions = useAsync(() => listResponseActions({ limit: 100 }), 30_000, ['actions']);
  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center gap-2">
        <p className="font-body text-xs text-on-surface-variant">
          Every self-healing response is recorded with its simulation flag (GET /response-actions). Sandbox actions never reach a real system.
        </p>
        <Proof
          source="GET /response-actions"
          n={actions.data?.length ?? 0}
          asOf={actions.loadedAt}
          definition="Response actions with action_type, target, reason and is_simulated. is_simulated is true for every sandboxed action."
          label="Containment actions"
        />
      </div>
      {actions.error && !actions.data ? (
        <EmptyState title="Could not load containment actions" description={actions.error} icon="warning" />
      ) : (
        <Table
          caption="Containment actions"
          columns={CONTAINMENT_COLUMNS}
          rows={actions.data ?? []}
          rowKey={(row) => row.id}
          empty={<EmptyState title="No containment actions yet" description="Sandboxed responses appear here once a threat verdict triggers one." icon="info" />}
        />
      )}
    </div>
  );
}
