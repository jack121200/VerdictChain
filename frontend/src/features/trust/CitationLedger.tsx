/** The Watchdog's citation ledger: every cited row with its check, filtered and paged. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { listCitations } from '../../api/client';
import type { CitationStatus, CitationListParams, InvestigatorId } from '../../api/types';
import { usePageData } from '../../app/use-page-data';
import { INVESTIGATOR_VISUALS } from '../../lib/agents';
import { cn } from '../../lib/cn';
import { formatCount, formatCountNoun, shortId } from '../../lib/format';
import { CopyHash } from '../../ui/CopyHash';
import { Icon } from '../../ui/Icon';
import { Proof } from '../../ui/Proof';
import { Skeleton } from '../../ui/Skeleton';
import { TONE_BAR } from './shared';

export const CITE_PAGE_SIZE = 20;

export const STATUS_BADGE: Record<CitationStatus, string> = {
  VERIFIED: 'bg-secondary/15 text-secondary border border-secondary/30',
  DISCREPANCY: 'bg-tertiary/20 text-tertiary border border-tertiary/40',
  INVALID_ROW: 'bg-error-container/40 text-error border border-error/40',
};
export const STATUS_ICON: Record<CitationStatus, 'check' | 'warning' | 'close'> = {
  VERIFIED: 'check',
  DISCREPANCY: 'warning',
  INVALID_ROW: 'close',
};

// ---- Section 4: citation ledger ------------------------------------------------

export const CITE_FILTERS: ReadonlyArray<{ value: CitationStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'VERIFIED', label: 'Verified' },
  { value: 'DISCREPANCY', label: 'Discrepancies' },
  { value: 'INVALID_ROW', label: 'Invalid' },
];

export function CitationLedger({ nameOf }: { nameOf: (agentId: InvestigatorId) => string }) {
  const [filter, setFilter] = useState<CitationStatus | 'ALL'>('ALL');
  const [offset, setOffset] = useState(0);

  const params = useMemo<CitationListParams>(
    () => ({ limit: CITE_PAGE_SIZE, offset, status: filter === 'ALL' ? undefined : filter }),
    [filter, offset],
  );
  const page = usePageData(() => listCitations(params), undefined, ['credibility', 'investigations']);
  const { reload } = page;
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    reload();
  }, [params, reload]);

  const items = page.data?.items ?? [];
  const canPrev = offset > 0;
  // The citations endpoint reports no total, so a full page is the only sign that more may follow.
  const canNext = items.length >= CITE_PAGE_SIZE;

  return (
    <section className="space-y-4 rounded-xl border border-outline-variant/40 bg-surface-container-low p-5 shadow-md">
      <div className="flex flex-col justify-between gap-3 border-b border-outline-variant/30 pb-2 md:flex-row md:items-center">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Icon name="receipt_long" size={20} className="text-primary" />
            <h2 className="font-headline text-base font-bold text-on-surface">Evidence citation validation ledger</h2>
          </div>
          <p className="font-body text-xs text-on-surface-variant">
            Every cited row the Watchdog re-checked against raw_logs: the cited value next to the value the row actually
            holds.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
          <span className="uppercase text-on-surface-variant">Filter:</span>
          {CITE_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filter === option.value}
              onClick={() => {
                setOffset(0);
                setFilter(option.value);
              }}
              className={cn(
                'cursor-pointer rounded px-2.5 py-1 font-semibold uppercase transition-colors',
                filter === option.value ? 'bg-primary-container text-on-primary' : 'bg-surface-card text-on-surface-variant hover:text-on-surface',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="w-full overflow-x-auto">
        <table className="w-full border-collapse text-left font-mono text-xs">
          <thead>
            <tr className="border-b border-outline-variant/40 bg-background text-[10px] uppercase tracking-wider text-on-surface-variant">
              <th className="px-3 py-2">Cited row</th>
              <th className="px-3 py-2">Sponsoring agent</th>
              <th className="px-3 py-2">Field / investigation</th>
              <th className="px-3 py-2">Row value (raw_logs)</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/20">
            {items.map((row, index) => (
              <tr
                key={`${row.investigation_id}-${row.row_id}-${row.field}-${index}`}
                className={cn(
                  'transition-colors',
                  row.status === 'DISCREPANCY'
                    ? 'bg-tertiary-container/5 hover:bg-tertiary-container/10'
                    : row.status === 'INVALID_ROW'
                      ? 'bg-error-container/10 hover:bg-error-container/20'
                      : 'hover:bg-surface-card',
                )}
              >
                <td className="px-3 py-2.5 font-semibold">
                  <CopyHash value={row.row_id} display={shortId(row.row_id)} label="cited row id" size="inherit" textClassName="text-primary" />
                </td>
                <td className="px-3 py-2.5">
                  <span className="flex items-center gap-2 text-on-surface">
                    <span className={cn('h-1.5 w-1.5 rounded-full', TONE_BAR[INVESTIGATOR_VISUALS[row.agent_id].tone])} aria-hidden="true" />
                    {nameOf(row.agent_id)}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-on-surface-variant">
                  <span className="text-on-surface">
                    {row.field}={row.value ?? '∅'}
                  </span>
                  <span className="block text-[10px] uppercase text-outline">
                    inv{' '}
                    <CopyHash value={row.investigation_id} display={shortId(row.investigation_id)} label="investigation id" size="inherit" textClassName="text-outline" /> · r
                    {formatCount(row.round)}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-[11px]">
                  <code className="rounded border border-outline-variant/30 bg-background px-1.5 py-0.5 text-on-surface">
                    {row.expected ?? '∅'}
                  </code>
                </td>
                <td className="px-3 py-2.5">
                  <span className={cn('inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase', STATUS_BADGE[row.status])}>
                    <Icon name={STATUS_ICON[row.status]} size={12} />
                    {row.status}
                  </span>
                </td>
                <td
                  className={cn(
                    'px-3 py-2.5 text-right font-semibold',
                    row.status === 'VERIFIED' ? 'text-secondary' : row.status === 'DISCREPANCY' ? 'text-tertiary' : 'text-error',
                  )}
                >
                  {row.reason}
                </td>
              </tr>
            ))}
            {page.status === 'ready' && items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-on-surface-variant">
                  No citations match this filter yet.
                </td>
              </tr>
            )}
            {page.status === 'loading' && (
              <tr>
                <td colSpan={6} className="px-3 py-4">
                  <Skeleton className="h-4 w-full" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col justify-between gap-2 border-t border-outline-variant/30 pt-2 font-mono text-[10px] text-on-surface-variant sm:flex-row sm:items-center">
        <span className="inline-flex items-center gap-2">
          Displaying {formatCountNoun(items.length, 'checked citation')}
          <Proof
            source="GET /citations"
            n={items.length}
            asOf={page.loadedAt}
            label="Citations shown"
            definition={`Rows returned for the current status filter and page (limit ${formatCount(CITE_PAGE_SIZE)}, offset ${formatCount(offset)}). The citations endpoint reports no total count, so none is shown; Next is offered when a full page came back.`}
          />
          {page.error && <span className="text-error">· {page.error}</span>}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={!canPrev}
            onClick={() => setOffset((value) => Math.max(0, value - CITE_PAGE_SIZE))}
            className="rounded bg-surface-card px-2 py-1 uppercase text-on-surface hover:bg-surface-container-high disabled:opacity-40"
          >
            Previous
          </button>
          <span className="px-2 font-bold text-primary">
            rows {formatCount(offset + 1)}–{formatCount(offset + items.length)}
          </span>
          <button
            type="button"
            disabled={!canNext}
            onClick={() => setOffset((value) => value + CITE_PAGE_SIZE)}
            className="rounded bg-surface-card px-2 py-1 uppercase text-on-surface hover:bg-surface-container-high disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}
