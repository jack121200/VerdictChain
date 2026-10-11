/** The evidence storyline of one case: the cited rows in the order they happened, with what the Watchdog found. */
import type { CitationStatus, InvestigationCitations } from '../../api/types';
import { cn } from '../../lib/cn';
import { formatCount, formatCountNoun, formatDuration, shortId } from '../../lib/format';
import { CopyHash } from '../../ui/CopyHash';
import { Icon } from '../../ui/Icon';
import { Proof } from '../../ui/Proof';
import { Skeleton } from '../../ui/Skeleton';
import { Timestamp } from '../../ui/Timestamp';
import { buildStoryline } from './storyline';
import { MAX_STORY_ROWS, useCitedRows } from './useCitedRows';

const DOT: Record<CitationStatus, string> = {
  VERIFIED: 'border-secondary bg-secondary/30',
  DISCREPANCY: 'border-tertiary bg-tertiary/30',
  INVALID_ROW: 'border-error bg-error/30',
};

const STATUS_WORD: Record<CitationStatus, string> = {
  VERIFIED: 'verified',
  DISCREPANCY: 'discrepancy',
  INVALID_ROW: 'invalid row',
};

export function EvidenceStoryline({ citations }: { citations: InvestigationCitations | undefined }) {
  const all = citations?.citations ?? [];
  const cited = useCitedRows(all.map((citation) => citation.row_id));
  const story = buildStoryline(cited.rows, all);
  const distinct = new Set(all.map((citation) => citation.row_id)).size;

  return (
    <section aria-label="Evidence storyline" className="space-y-3 rounded-lg border border-outline-variant/40 bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] font-semibold uppercase text-outline">Evidence storyline</span>
        <Proof
          source="GET /raw-logs/{row_id} (cited rows) · GET /investigations/{id}/citations"
          n={cited.rows.length}
          asOf={cited.loadedAt}
          label="Evidence storyline"
          definition={`The rows this case's investigators cited, re-read from raw_logs and ordered by the row's own timestamp. The dot is the Watchdog's worst finding among the citations of that row. Up to ${MAX_STORY_ROWS} distinct rows are read; this case cited ${distinct}. A row that cannot be read is counted below, never drawn. No label is shown.`}
          inputs={[
            { label: 'rows cited', value: String(distinct) },
            { label: 'rows read', value: String(cited.rows.length) },
            { label: 'rows unreadable', value: String(cited.failed) },
          ]}
        />
      </div>

      {citations === undefined ? (
        <Skeleton className="h-16 w-full" />
      ) : distinct === 0 ? (
        <p className="font-mono text-[11px] text-on-surface-variant">No row was cited, so there is no storyline yet.</p>
      ) : cited.status !== 'ready' ? (
        <Skeleton className="h-24 w-full" />
      ) : story.events.length === 0 ? (
        <p className="font-mono text-[11px] text-error">None of the {formatCountNoun(cited.requested, 'cited row')} could be read from raw_logs.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
            {story.users.slice(0, 3).map((user) => (
              <span key={`u-${user.value}`} className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-primary">
                <Icon name="badge" size={12} />
                {user.value} ×{formatCount(user.count)}
              </span>
            ))}
            {story.hosts.slice(0, 3).map((host) => (
              <span key={`h-${host.value}`} className="inline-flex items-center gap-1 rounded border border-tertiary/40 bg-tertiary/10 px-1.5 py-0.5 text-tertiary">
                <Icon name="lan" size={12} />
                {host.value} ×{formatCount(host.count)}
              </span>
            ))}
            {story.spanMs !== null && <span className="text-on-surface-variant">{formatDuration(story.spanMs)} of activity</span>}
          </div>

          <ol className="relative space-y-2.5 border-l border-outline-variant/50 pl-4">
            {story.events.map((event) => (
              <li key={event.rowId} className="relative text-[11px]">
                <span aria-hidden="true" className={cn('absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border', event.status === null ? 'border-outline' : DOT[event.status])} />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono">
                  <Timestamp iso={event.at} mode="absolute" className="text-on-surface" />
                  <span className="rounded bg-surface-container-high px-1.5 text-[10px] text-on-surface-variant">{event.eventType ?? event.source}</span>
                  {(event.user ?? event.host) && (
                    <span className="text-on-surface-variant">
                      {event.user ?? '—'}
                      {event.host ? ` @ ${event.host}` : ''}
                    </span>
                  )}
                  <CopyHash value={event.rowId} display={shortId(event.rowId)} label="cited row id" size="inherit" textClassName="text-outline" />
                  {event.status && <span className="sr-only">{STATUS_WORD[event.status]}</span>}
                </div>
                {event.citations.length > 0 && (
                  <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-on-surface-variant">
                    {event.citations.slice(0, 3).map((citation) => (
                      <span key={`${citation.field}|${citation.value}|${citation.status}`} className="inline-flex items-center gap-1">
                        <Icon name={citation.status === 'VERIFIED' ? 'check' : 'warning'} size={12} className={citation.status === 'VERIFIED' ? 'text-secondary' : 'text-tertiary'} />
                        {citation.field}={citation.value ?? '∅'}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>

          {cited.failed > 0 && (
            <p className="font-mono text-[10px] text-error">
              {formatCountNoun(cited.failed, 'cited row')} could not be read and {cited.failed === 1 ? 'is' : 'are'} left out.
            </p>
          )}
          {distinct > cited.requested && (
            <p className="font-mono text-[10px] text-on-surface-variant">
              Showing the first {formatCount(cited.requested)} of {formatCount(distinct)} cited rows.
            </p>
          )}
        </>
      )}
    </section>
  );
}
