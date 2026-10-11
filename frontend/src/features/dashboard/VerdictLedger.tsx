/** The ledger of recent verdicts with their audit hashes. */
import type { InvestigationSummary } from '../../api/types';
import { buildRoute } from '../../app/router';
import { cn } from '../../lib/cn';
import { formatCount, formatOutOf, shortId } from '../../lib/format';
import { CopyButton, CopyHash } from '../../ui/CopyHash';
import { RunScenarioAction } from '../../shell/RunScenarioAction';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { Proof } from '../../ui/Proof';
import { Skeleton } from '../../ui/Skeleton';
import { StubBadge } from '../../ui/StubBadge';
import { statusIcon, verdictIcon } from '../investigations/labels';
import { PERCENT1, verdictPillClass } from './shared';

// ---- 4. Verdict ledger + terminal -------------------------------------------------

export interface VerdictLedgerProps {
  rows: readonly InvestigationSummary[];
  loading: boolean;
  hashFor: (investigationId: string) => string | null;
  debateRounds: number | undefined;
  headSeq: number | null;
  chainLoadedAt: string | null;
}

export function VerdictLedger({ rows, loading, hashFor, debateRounds, headSeq, chainLoadedAt }: VerdictLedgerProps) {
  return (
    <div className="flex flex-col justify-between rounded-xl border border-outline-variant/40 bg-surface-container-low p-4 shadow-xl lg:col-span-7">
      <div>
        <div className="mb-3 flex items-center justify-between border-b border-outline-variant/30 pb-2">
          <div className="flex items-center gap-2">
            <Icon name="receipt_long" size={20} className="text-primary" />
            <span className="font-headline text-base font-semibold uppercase tracking-wider text-on-surface">Verdict ledger</span>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded border border-secondary/30 bg-secondary/10 px-2 py-0.5 font-mono text-[10px] font-bold text-secondary">
            Deterministic aggregation
            <Proof
              source="GET /investigations · GET /audit-trail?action=verdict_reached"
              n={rows.length}
              asOf={chainLoadedAt}
              label="Verdict ledger"
              definition="The most recent investigations. The audit hash is the entry_hash of each investigation's verdict_reached audit entry. Aggregation of votes is deterministic code."
            />
          </span>
        </div>

        {rows.length === 0 ? (
          loading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <EmptyState
              title="No investigations yet"
              description="Run a scenario to start the first debate; its verdict and audit hash appear here."
              action={<RunScenarioAction />}
            />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-[11px]">
              <caption className="sr-only">Recent investigations and their verdicts</caption>
              <thead>
                <tr className="border-b border-outline-variant/40 bg-background text-[10px] uppercase text-on-surface-variant">
                  {['Incident ref', 'Vector / ingestion', 'Debate', 'Final verdict', 'Agent-reported conf.', 'Audit hash'].map((header, index) => (
                    <th key={header} scope="col" className={cn('px-3 py-2 font-semibold', index === 5 && 'text-right')}>
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/20">
                {rows.map((row) => {
                  const hash = hashFor(row.id);
                  return (
                    <tr key={row.id} className="transition-colors hover:bg-surface-card">
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-1.5">
                          <a href={buildRoute({ name: 'debate', id: row.id })} className="font-semibold text-primary hover:underline">
                            {shortId(row.id)}
                          </a>
                          <CopyButton value={row.id} label={`investigation id ${shortId(row.id)}`} />
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-on-surface">
                        <span className="inline-flex flex-wrap items-center gap-2">
                          {row.dataset ?? '—'}
                          <StubBadge source={row.data_source} />
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-semibold text-secondary">
                        {debateRounds !== undefined ? formatOutOf(row.rounds_complete, debateRounds) : formatCount(row.rounds_complete)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', verdictPillClass(row.verdict_class))}>
                          <Icon name={row.verdict_class === null ? statusIcon(row.status) : verdictIcon(row.verdict_class)} size={12} />
                          {row.verdict_class ?? row.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-semibold text-on-surface">
                        {row.verdict_confidence === null ? '—' : PERCENT1(row.verdict_confidence)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {hash ? <CopyHash value={hash} label={`verdict audit hash for ${shortId(row.id)}`} /> : <span className="text-on-surface-variant">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between rounded border-t border-outline-variant/30 bg-background p-2 font-mono text-[10px] text-on-surface-variant">
        <span className="inline-flex items-center gap-1.5">
          <Icon name="receipt_long" size={12} className="text-secondary" />
          Audit head seq <span className="text-secondary">{headSeq ?? '—'}</span>
          <Proof source="GET /audit-trail (chain.head_seq)" n={1} asOf={chainLoadedAt} label="Audit head seq" definition="The sequence number of the latest audit entry." />
        </span>
        <a href={buildRoute({ name: 'audit' })} className="text-primary hover:underline">
          Open audit trail →
        </a>
      </div>
    </div>
  );
}
