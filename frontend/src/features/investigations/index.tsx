import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getAgentFleet,
  getEvidenceBundle,
  getInvestigation,
  getInvestigationCitations,
  listAuditTrail,
  listInvestigations,
  describeError,
} from '../../api/client';
import type {
  FleetEntry,
  InvestigationListParams,
  InvestigationStatus,
  InvestigatorId,
  VerdictClass,
} from '../../api/types';
import type { PageProps } from '../index';
import { useAsync } from '../../app/use-async';
import { buildRoute } from '../../app/router';
import { AGENT_VISUALS } from '../../lib/agents';
import { cn } from '../../lib/cn';
import { formatPercent, formatTimestamp, shortId } from '../../lib/format';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { Metric } from '../../ui/Metric';
import { Proof } from '../../ui/Proof';
import { Skeleton } from '../../ui/Skeleton';
import { Dossier, type DossierData, type Loaded } from './Dossier';
import { STATUS_LABEL, VERDICT_LABEL, statusTone, verdictIcon, verdictTone, type PillTone } from './labels';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

/** Left accent strip colour, keyed by the card's tone (SKILL section 3). */
const ACCENT: Record<PillTone, string> = {
  primary: 'bg-primary',
  secondary: 'bg-secondary',
  tertiary: 'bg-tertiary',
  error: 'bg-error',
  neutral: 'bg-outline',
};

/** Verdict/status badge classes in the reference's exact style (hex mapped to tokens). */
const BADGE: Record<PillTone, string> = {
  error: 'bg-error-container/40 text-error border border-error/40',
  tertiary: 'bg-tertiary-container/20 text-tertiary border border-tertiary/40',
  secondary: 'bg-secondary-container/20 text-secondary border border-secondary/40',
  primary: 'bg-primary-container/20 text-primary border border-primary/40',
  neutral: 'bg-surface-container-high text-on-surface-variant border border-outline-variant/40',
};

const STATUS_OPTIONS: ReadonlyArray<{ value: InvestigationStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'investigating', label: STATUS_LABEL.investigating },
  { value: 'verdict_reached', label: STATUS_LABEL.verdict_reached },
  { value: 'contained', label: STATUS_LABEL.contained },
  { value: 'ambiguous', label: STATUS_LABEL.ambiguous },
  { value: 'error', label: STATUS_LABEL.error },
];

const VERDICT_OPTIONS: ReadonlyArray<{ value: VerdictClass | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'All verdicts' },
  ...(Object.keys(VERDICT_LABEL) as VerdictClass[]).map((value) => ({ value, label: VERDICT_LABEL[value] })),
];

function settled<T>(result: PromiseSettledResult<T>): Loaded<T> {
  return result.status === 'fulfilled' ? { data: result.value } : { error: describeError(result.reason) };
}

/** Investigations: a filterable list on the left and a live dossier inspector on the right (plan 2.6). */
export default function InvestigationsPage({ id }: PageProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<InvestigationStatus | 'ALL'>('ALL');
  const [verdictFilter, setVerdictFilter] = useState<VerdictClass | 'ALL'>('ALL');
  const [agentFilter, setAgentFilter] = useState<InvestigatorId | 'ALL'>('ALL');
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(id ?? null);
  const [dossier, setDossier] = useState<DossierData | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // A deep link (#/investigations/<id>) pre-selects that case.
  useEffect(() => {
    if (id) setSelectedId(id);
  }, [id]);

  // Debounce the search box so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const fleet = useAsync(getAgentFleet, undefined, ['agents', 'credibility']);

  const params = useMemo<InvestigationListParams>(
    () => ({
      limit: PAGE_SIZE,
      offset,
      q: debouncedQuery === '' ? undefined : debouncedQuery,
      status: statusFilter === 'ALL' ? undefined : statusFilter,
      verdict_class: verdictFilter === 'ALL' ? undefined : verdictFilter,
      primary_agent: agentFilter === 'ALL' ? undefined : agentFilter,
    }),
    [offset, debouncedQuery, statusFilter, verdictFilter, agentFilter],
  );

  const list = useAsync(() => listInvestigations(params), undefined, ['investigations']);
  const { reload: reloadList } = list;

  // Refetch the list when the filters or page change (useAsync itself only loads on mount).
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    reloadList();
  }, [params, reloadList]);

  const agentName = useCallback(
    (agentId: string): string => {
      const match = fleet.data?.find((entry: FleetEntry) => entry.agent_id === agentId);
      return match?.display_name ?? agentId;
    },
    [fleet.data],
  );

  const items = list.data?.items ?? [];
  const summaryFor = useCallback((caseId: string) => items.find((item) => item.id === caseId), [items]);

  // Load the four dossier requests whenever the selection (or a feedback action) changes.
  useEffect(() => {
    const target = selectedId;
    if (target === null) {
      setDossier(null);
      return;
    }
    let cancelled = false;
    setDossier({ id: target, summary: summaryFor(target), detail: {}, bundle: {}, citations: {}, audit: {}, loadedAt: null });
    Promise.allSettled([
      getInvestigation(target),
      getEvidenceBundle(target),
      getInvestigationCitations(target),
      listAuditTrail({ investigation_id: target, limit: 100 }),
    ]).then((results) => {
      if (cancelled) return;
      const [detail, bundle, citations, audit] = results;
      setDossier({
        id: target,
        summary: summaryFor(target),
        detail: settled(detail),
        bundle: settled(bundle),
        citations: settled(citations),
        audit: settled(audit),
        loadedAt: new Date().toISOString(),
      });
    });
    return () => {
      cancelled = true;
    };
    // summaryFor is intentionally excluded: it changes with every list reload and must not refetch the dossier.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, reloadKey]);

  function changeFilter(apply: () => void) {
    setOffset(0);
    apply();
  }

  const agentOptions = fleet.data ?? [];
  const total = list.data?.total;
  const canPrev = offset > 0;
  const canNext = total?.value != null && offset + items.length < total.value;

  const selectClass =
    'cursor-pointer rounded border border-outline-variant/50 bg-background px-2.5 py-1 font-mono text-[11px] text-on-surface focus:border-primary focus:outline-none';

  return (
    <div className="relative flex min-h-screen w-full flex-col text-on-surface">
      <section className="relative mx-auto w-full max-w-7xl px-4 pb-6 pt-6 lg:px-6">
        {/* Screen Header */}
        <div className="flex flex-col justify-between gap-4 border-b border-outline-variant/40 pb-6 md:flex-row md:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-primary">
              <span className="h-2 w-2 animate-pulse rounded-full bg-primary" aria-hidden="true" />
              <span>Forensic Dossiers &amp; Cases • Deterministic Consensus Registry</span>
            </div>
            <h1 className="font-headline text-3xl font-bold tracking-tight text-on-surface sm:text-4xl">
              Active &amp; Closed <span className="text-primary">Investigations</span>
            </h1>
            <p className="mt-1 max-w-2xl font-body text-sm text-on-surface-variant">
              Forensic dossiers from the multi-agent debate, each verified by the Watchdog against the raw logs in
              PostgreSQL. Every value below is an API field or a Proof-documented derivation — no case ids, hashes or
              hosts are typed in.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={() => {
                window.location.hash = buildRoute({ name: 'dashboard' });
              }}
              className={cn(
                'flex items-center gap-2 rounded bg-primary-container px-3 py-2 font-mono text-xs font-bold uppercase text-on-primary shadow-glow-cyan transition-all hover:bg-primary',
              )}
            >
              <Icon name="admin_panel_settings" size={16} />
              <span>Inject Scenario</span>
            </button>
            <button
              type="button"
              disabled={selectedId === null}
              onClick={() => {
                if (selectedId !== null) window.location.hash = buildRoute({ name: 'debate', id: selectedId });
              }}
              className="flex items-center gap-2 rounded border border-primary/40 bg-surface-card px-3 py-2 font-mono text-xs uppercase text-primary transition-all hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon name="sync_alt" size={16} />
              <span>Open Replay</span>
            </button>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="mt-6 flex flex-col items-stretch justify-between gap-3 rounded-xl border border-outline-variant/40 bg-surface-container-low/80 p-3 backdrop-blur-md lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">
              <Icon name="travel_explore" size={16} />
            </span>
            <input
              type="search"
              value={query}
              onChange={(event) => changeFilter(() => setQuery(event.target.value))}
              placeholder="Search by case id, actor, asset or attack vector…"
              aria-label="Search investigations"
              className="w-full rounded-lg border border-outline-variant/50 bg-background py-2 pl-9 pr-9 font-mono text-xs text-on-surface placeholder:text-outline focus:border-primary focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => changeFilter(() => setQuery(''))}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
              >
                <Icon name="close" size={16} />
              </button>
            )}
          </div>

          {/* Primary-agent filter pills (datasets map from the primary agent, plan 2.6). */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0">
            <span className="mr-1 font-mono text-[10px] uppercase text-on-surface-variant">Agent:</span>
            <FilterPill active={agentFilter === 'ALL'} onClick={() => changeFilter(() => setAgentFilter('ALL'))}>
              All
            </FilterPill>
            {agentOptions.map((entry) => (
              <FilterPill
                key={entry.agent_id}
                active={agentFilter === entry.agent_id}
                onClick={() => changeFilter(() => setAgentFilter(entry.agent_id))}
              >
                {AGENT_VISUALS[entry.agent_id].glyph} {entry.display_name}
              </FilterPill>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] uppercase text-on-surface-variant">Status:</span>
            <select
              aria-label="Status filter"
              value={statusFilter}
              onChange={(event) => changeFilter(() => setStatusFilter(event.target.value as InvestigationStatus | 'ALL'))}
              className={selectClass}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="ml-1 font-mono text-[10px] uppercase text-on-surface-variant">Verdict:</span>
            <select
              aria-label="Verdict filter"
              value={verdictFilter}
              onChange={(event) => changeFilter(() => setVerdictFilter(event.target.value as VerdictClass | 'ALL'))}
              className={selectClass}
            >
              {VERDICT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Content: left master list / right detail dossier */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-3 lg:col-span-7">
            <div className="flex items-center justify-between px-1 font-mono text-xs text-on-surface-variant">
              <span className="inline-flex items-center gap-2">
                Showing {items.length} of
                <Metric size="body" label="Total investigations matching the filters" metric={total} />
                dossiers
              </span>
              {list.error !== null && <span className="text-error">{list.error}</span>}
            </div>

            {list.data === undefined && list.error === null && (
              <div className="space-y-3">
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
              </div>
            )}

            {list.data !== undefined && items.length === 0 && (
              <EmptyState
                icon="travel_explore"
                title="No investigations match"
                description="No case matches the current filters yet. Start one from the scenario modal on the dashboard."
              />
            )}

            {items.map((item) => {
              const selected = item.id === selectedId;
              const tone = item.verdict_class === null ? statusTone(item.status) : verdictTone(item.verdict_class);
              return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  onClick={() => setSelectedId(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedId(item.id);
                    }
                  }}
                  className={cn(
                    'relative cursor-pointer overflow-hidden rounded-xl border p-4 text-left transition-all',
                    selected
                      ? 'border-primary bg-surface-card shadow-glow-cyan ring-1 ring-primary/50'
                      : 'border-outline-variant/40 bg-surface-container-low/70 hover:border-outline-variant hover:bg-surface-card/60',
                  )}
                >
                  <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-1', ACCENT[tone])} />
                  <div className="flex items-start justify-between gap-3 pl-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-bold text-primary">{shortId(item.id)}</span>
                        {item.dataset && (
                          <span className="rounded border border-outline-variant/40 bg-background px-2 py-0.5 font-mono text-[10px] text-on-surface-variant">
                            {item.dataset}
                          </span>
                        )}
                        <span className="font-mono text-[10px] text-outline">{formatTimestamp(item.created_at)}</span>
                      </div>
                      <h3 className="mt-1 font-headline text-base font-semibold text-on-surface">{item.trigger_type}</h3>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 font-body text-xs text-on-surface-variant">
                        {item.primary_agent && (
                          <span>
                            Agent:{' '}
                            <code className="text-primary">
                              {AGENT_VISUALS[item.primary_agent].glyph} {agentName(item.primary_agent)}
                            </code>
                          </span>
                        )}
                        <span aria-hidden="true">•</span>
                        <span>
                          Noise: <code className="text-on-surface">{item.noise_pct}%</code>
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider',
                          BADGE[tone],
                        )}
                      >
                        <Icon
                          name={item.verdict_class === null ? 'info' : verdictIcon(item.verdict_class)}
                          size={12}
                        />
                        {item.verdict_class === null ? STATUS_LABEL[item.status] : VERDICT_LABEL[item.verdict_class]}
                      </span>
                      <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-on-surface">
                        {item.verdict_confidence === null ? '—' : formatPercent(item.verdict_confidence)} conf.
                        <Proof
                          source="GET /investigations.verdict_confidence"
                          n={item.verdict_confidence === null ? 0 : 1}
                          asOf={item.created_at}
                          definition="Agent-reported verdict confidence (mean of the supporting agents' self-reported confidence). This is agent-reported confidence, not accuracy; accuracy comes only from /evaluation."
                          reason={item.verdict_confidence === null ? 'no verdict confidence yet' : null}
                          label="Agent-reported confidence"
                        />
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-outline-variant/30 pl-2 pt-2.5 font-mono text-[11px] text-on-surface-variant">
                    <span className="flex items-center gap-1.5">
                      <Icon name="verified_user" size={12} className="text-secondary" />
                      <span>
                        Containment: <strong className="text-on-surface">{item.containment_count}</strong>
                      </span>
                    </span>
                    <span className="text-outline">
                      {item.rounds_complete} rounds · {STATUS_LABEL[item.status]}
                    </span>
                  </div>
                </div>
              );
            })}

            {(canPrev || canNext) && (
              <div className="flex items-center justify-between px-1 pt-1 font-mono text-[11px] text-on-surface-variant">
                <button
                  type="button"
                  disabled={!canPrev}
                  onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}
                  className="rounded bg-surface-card px-2 py-1 uppercase text-on-surface hover:bg-surface-container-high disabled:opacity-40"
                >
                  Previous
                </button>
                <span>offset {offset}</span>
                <button
                  type="button"
                  disabled={!canNext}
                  onClick={() => setOffset((value) => value + PAGE_SIZE)}
                  className="rounded bg-surface-card px-2 py-1 uppercase text-on-surface hover:bg-surface-container-high disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
          </div>

          {/* Right: dossier */}
          <div className="lg:col-span-5">
            <Dossier dossier={dossier} onChanged={() => setReloadKey((value) => value + 1)} />
          </div>
        </div>
      </section>
    </div>
  );
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'cursor-pointer whitespace-nowrap rounded px-2.5 py-1 font-mono text-[11px] uppercase transition-colors',
        active
          ? 'bg-primary font-bold text-on-primary shadow-sm'
          : 'bg-surface-card text-on-surface-variant hover:text-on-surface',
      )}
    >
      {children}
    </button>
  );
}
