import { listInvestigations } from '../../api/client';
import type { InvestigationSummary } from '../../api/types';
import { buildRoute } from '../../app/router';
import { useAsync } from '../../app/use-async';
import { cn } from '../../lib/cn';
import { formatCount, shortId } from '../../lib/format';
import { RunScenarioAction } from '../../shell/RunScenarioAction';
import { Card } from '../../ui/Card';
import { FOCUS_RING } from '../../ui/classes';
import { CopyHash } from '../../ui/CopyHash';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { PageHeader } from '../../ui/Headings';
import { HintStrip } from '../../ui/HintStrip';
import { Pill } from '../../ui/Pill';
import { Proof } from '../../ui/Proof';
import { Skeleton } from '../../ui/Skeleton';
import { Timestamp } from '../../ui/Timestamp';

const HINT = [
  'Debates that are running now are listed first, then the most recent finished cases; open a row to follow it live or to replay it.',
  'A replay reads the saved transcript and cited rows, so it makes no call to a model provider.',
  'The list comes from GET /investigations and refreshes itself every few seconds, so a new debate appears without a reload.',
] as const;

/** Live debates first, then the most recent closed ones. Refreshes every 4s so a running
 *  debate appears without a manual reload. Every row links to its debate room. */
export function DebateList() {
  const investigations = useAsync(() => listInvestigations({ limit: 50 }), 4000, ['investigations']);
  const rows = investigations.data?.items ?? [];
  const live = rows.filter((row) => row.status === 'investigating');
  // Waiting cases in the order the worker takes them: oldest first (the queue is first in, first out).
  const waiting = rows
    .filter((row) => row.status === 'queued')
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const recent = rows.filter((row) => row.status !== 'investigating' && row.status !== 'queued').slice(0, 12);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-6">
      <PageHeader
        title="Live debate"
        subtitle="Open an investigation that is debating now, or replay a closed one. This list refreshes on its own."
      />

      <HintStrip pageId="debate-list" sentences={HINT} className="mt-4" />

      {investigations.data === undefined && investigations.error === null && (
        <div className="mt-6 space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {investigations.error !== null && investigations.data === undefined && (
        <Card className="mt-6">
          <span className="text-caption text-error">{investigations.error}</span>
        </Card>
      )}

      {investigations.data !== undefined && rows.length === 0 && (
        <div className="mt-6">
          <EmptyState
            icon="forum"
            title="No debates yet"
            description="A debate starts when a scenario is run. Its three rounds stream live here, and finished ones stay open for replay."
            action={<RunScenarioAction />}
          />
        </div>
      )}

      {investigations.data !== undefined && rows.length > 0 && (
        <div className="mt-6 space-y-6">
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-error" aria-hidden="true" />
              <span className="text-label uppercase tracking-wider text-on-surface-variant">
                Debating now ({formatCount(live.length)})
              </span>
            </div>
            {live.length === 0 ? (
              <EmptyState
                icon="forum"
                title="No live debate"
                description="Nothing is debating right now. Run a scenario to start one; finished debates are listed below."
                action={<RunScenarioAction label="Run a scenario" />}
              />
            ) : (
              live.map((row) => <DebateRow key={row.id} row={row} live />)
            )}
          </section>

          {waiting.length > 0 && (
            <section className="space-y-2" aria-label="Waiting in the queue">
              <div className="flex items-center gap-2">
                <Icon name="schedule" size={14} className="text-on-surface-variant" />
                <span className="text-label uppercase tracking-wider text-on-surface-variant">
                  Waiting in the queue ({formatCount(waiting.length)})
                </span>
                <Proof
                  source="GET /investigations (status queued)"
                  n={waiting.length}
                  asOf={investigations.loadedAt}
                  label="Queue place"
                  definition="Place = the row's rank among investigations with status queued, ordered by created_at (oldest first). The worker takes them in that order, one at a time."
                />
              </div>
              {waiting.map((row, index) => (
                <DebateRow key={row.id} row={row} place={index + 1} />
              ))}
            </section>
          )}

          {recent.length > 0 && (
            <section className="space-y-2">
              <span className="text-label uppercase tracking-wider text-on-surface-variant">Recent ({formatCount(recent.length)})</span>
              {recent.map((row) => (
                <DebateRow key={row.id} row={row} />
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One row. The link covers the whole card; the copy button is positioned and later in the DOM, so it paints
 * above the link and stays clickable (a button may not sit inside a link).
 */
function DebateRow({ row, live = false, place }: { row: InvestigationSummary; live?: boolean; place?: number }) {
  return (
    <Card hoverTone="primary" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <a
        href={buildRoute({ name: 'debate', id: row.id })}
        aria-label={`Open debate room ${shortId(row.id)}`}
        className={cn('absolute inset-0 rounded-xl', FOCUS_RING)}
      />
      <div className="flex min-w-0 items-center gap-3">
        <Icon name={live ? 'forum' : 'gavel'} size={20} className={live ? 'text-primary' : 'text-on-surface-variant'} />
        <div className="flex min-w-0 flex-col">
          <CopyHash value={row.id} display={shortId(row.id)} label="investigation id" size="inherit" className="text-caption" textClassName="text-primary" />
          <Timestamp iso={row.created_at} className="text-caption text-on-surface-variant" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {row.verdict_class && <Pill tone="secondary">{row.verdict_class}</Pill>}
        <Pill tone={live ? 'error' : 'neutral'}>{place !== undefined ? `queued · place ${place}` : row.status}</Pill>
        <Icon name="chevron_right" size={16} className="hidden text-on-surface-variant sm:inline" />
      </div>
    </Card>
  );
}
