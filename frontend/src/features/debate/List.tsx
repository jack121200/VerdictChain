import { listInvestigations } from '../../api/client';
import type { InvestigationSummary } from '../../api/types';
import { buildRoute } from '../../app/router';
import { useAsync } from '../../app/use-async';
import { formatTimestamp, shortId } from '../../lib/format';
import { Card } from '../../ui/Card';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { PageHeader } from '../../ui/Headings';
import { Pill } from '../../ui/Pill';
import { Skeleton } from '../../ui/Skeleton';

/** Live debates first, then the most recent closed ones. Refreshes every 4s so a running
 *  debate appears without a manual reload. Every row links to its debate room. */
export function DebateList() {
  const investigations = useAsync(() => listInvestigations({ limit: 50 }), 4000, ['investigations']);
  const rows = investigations.data?.items ?? [];
  const live = rows.filter((row) => row.status === 'investigating');
  const recent = rows.filter((row) => row.status !== 'investigating').slice(0, 12);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-6">
      <PageHeader
        title="Live debate"
        subtitle="Open an investigation that is debating now, or replay a closed one. This list refreshes on its own."
      />

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

      {investigations.data !== undefined && (
        <div className="mt-6 space-y-6">
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-error" aria-hidden="true" />
              <span className="text-label uppercase tracking-wider text-on-surface-variant">
                Debating now ({live.length})
              </span>
            </div>
            {live.length === 0 ? (
              <EmptyState
                icon="forum"
                title="No live debate"
                description="Inject a scenario from the dashboard to start a 3-round debate."
                action={
                  <a href={buildRoute({ name: 'dashboard' })} className="text-body text-primary underline">
                    Go to the dashboard
                  </a>
                }
              />
            ) : (
              live.map((row) => <DebateRow key={row.id} row={row} live />)
            )}
          </section>

          {recent.length > 0 && (
            <section className="space-y-2">
              <span className="text-label uppercase tracking-wider text-on-surface-variant">Recent ({recent.length})</span>
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

function DebateRow({ row, live = false }: { row: InvestigationSummary; live?: boolean }) {
  return (
    <a href={buildRoute({ name: 'debate', id: row.id })} className="block">
      <Card hoverTone="primary" className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Icon name={live ? 'forum' : 'gavel'} size={20} className={live ? 'text-primary' : 'text-on-surface-variant'} />
          <div className="flex min-w-0 flex-col">
            <span className="font-mono text-caption text-primary">{shortId(row.id)}</span>
            <span className="text-caption text-on-surface-variant">{formatTimestamp(row.created_at)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {row.verdict_class && <Pill tone="secondary">{row.verdict_class}</Pill>}
          <Pill tone={live ? 'error' : 'neutral'}>{row.status}</Pill>
          <Icon name="chevron_right" size={16} className="text-on-surface-variant" />
        </div>
      </Card>
    </a>
  );
}
