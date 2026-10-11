/** One real citation from the latest investigation, floating over the hero image. */
import { getInvestigationCitations } from '../../api/client';
import type { CitationStatus } from '../../api/types';
import { useAsync } from '../../app/use-async';
import { cn } from '../../lib/cn';
import { Proof } from '../../ui/Proof';

export const CITATION_TONE: Record<CitationStatus, { label: string; cls: string }> = {
  VERIFIED: { label: 'Watchdog citation OK', cls: 'text-secondary' },
  DISCREPANCY: { label: 'Watchdog discrepancy', cls: 'text-tertiary' },
  INVALID_ROW: { label: 'Invalid cited row', cls: 'text-error' },
};

/** One real citation from the latest investigation, floating over the hero image. */
export function CitationPin({ investigationId }: { investigationId: string }) {
  const citations = useAsync(() => getInvestigationCitations(investigationId), undefined, ['investigations', 'credibility'], [investigationId]);
  const first = citations.data?.citations?.[0];
  const summary = citations.data?.summary;

  return (
    <div className="absolute bottom-6 right-6 max-w-sm rounded border border-primary-container/40 bg-surface-container-lowest/90 p-3 text-left shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-outline-variant/30 pb-1">
        <span className={cn('flex items-center gap-1 font-mono text-[10px] font-bold', first ? CITATION_TONE[first.status].cls : 'text-on-surface-variant')}>
          <span className="h-2 w-2 rounded-full bg-secondary animate-pulse" aria-hidden="true" />
          {first ? CITATION_TONE[first.status].label : 'No citations yet'}
        </span>
        <span className="inline-flex items-center gap-1 font-mono text-[9px] text-on-surface-variant">
          Postgres re-checked
          <Proof
            source="GET /investigations/{id}/citations"
            n={summary?.total ?? 0}
            asOf={citations.loadedAt}
            definition="One real citation from the latest investigation, re-checked against raw_logs. status is VERIFIED, DISCREPANCY or INVALID_ROW."
            label="Watchdog citation"
          />
        </span>
      </div>
      {first ? (
        <p className="mt-1.5 font-mono text-[11px] text-on-surface">
          Row <span className="font-semibold text-primary">{first.row_id}</span> field{' '}
          <span className="text-primary-fixed">{first.field}</span> = <span className="text-on-surface-variant">{first.value ?? '—'}</span>
          {first.row_fingerprint ? <span className="mt-1 block break-all text-[9px] text-on-surface-variant">fingerprint {first.row_fingerprint}</span> : null}
        </p>
      ) : (
        <p className="mt-1.5 font-mono text-[11px] text-on-surface-variant">Citations appear here once an investigation cites raw-log rows.</p>
      )}
    </div>
  );
}
