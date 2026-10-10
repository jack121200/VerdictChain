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
import { formatCount, formatCountNoun, formatPercent, formatPercentPoints, shortId } from '../../lib/format';
import { RunScenarioAction } from '../../shell/RunScenarioAction';
import { useScenarioModal } from '../../shell/scenario-modal';
import { Button } from '../../ui/Button';
import { FOCUS_RING } from '../../ui/classes';
import { CopyHash } from '../../ui/CopyHash';
import { EmptyState } from '../../ui/EmptyState';
import { FilterMenu, type FilterGroup } from '../../ui/FilterMenu';
import { HintStrip } from '../../ui/HintStrip';
import { Icon } from '../../ui/Icon';
import { Proof } from '../../ui/Proof';
import { Skeleton } from '../../ui/Skeleton';
import { StubBadge } from '../../ui/StubBadge';
import { Timestamp } from '../../ui/Timestamp';
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
  { value: 'queued', label: STATUS_LABEL.queued },
  { value: 'investigating', label: STATUS_LABEL.investigating },
  { value: 'verdict_reached', label: STATUS_LABEL.verdict_reached },
  { value: 'contained', label: STATUS_LABEL.contained },
  { value: 'ambiguous', label: STATUS_LABEL.ambiguous },
  { value: 'error', label: STATUS_LABEL.error },
];

const VERDICT_OPTIONS: ReadonlyArray<{ value: VerdictClass | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'All verdict classes' },
  ...(Object.keys(VERDICT_LABEL) as VerdictClass[]).map((value) => ({ value, label: VERDICT_LABEL[value] })),
];

const HINT = [
  'Pick a case on the left to open its dossier on the right: the verdict, the evidence bundle digest, the Watchdog’s check of each cited row and any sandbox containment.',
  'Search matches the start of the case id, the verdict class or the trigger type, and the Filters menu narrows the list by status, verdict class and primary agent; the server applies both (GET /investigations).',
  'Confidence on a card is agent-reported (the mean of the supporting agents’ self-reported confidence), not accuracy; the info button beside a number shows its source.',
] as const;

function settled<T>(result: PromiseSettledResult<T>): Loaded<T> {
  return result.status === 'fulfilled' ? { data: result.value } : { error: describeError(result.reason) };
}

/** Investigations: a filterable list on the left and a live dossier inspector on the right (plan 2.6). */
export default function InvestigationsPage({ id }: PageProps) {
  const scenario = useScenarioModal();
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

  function clearFilters() {
    changeFilter(() => {
      setStatusFilter('ALL');
      setVerdictFilter('ALL');
      setAgentFilter('ALL');
    });
  }

  function clearAll() {
    changeFilter(() => {
      setStatusFilter('ALL');
      setVerdictFilter('ALL');
      setAgentFilter('ALL');
      setQuery('');
    });
  }

  const selectedAgent = fleet.data?.find((entry) => entry.agent_id === agentFilter);
  const agentOptions = [
    { value: 'ALL', label: 'All primary agents' },
    ...(fleet.data ?? []).map((entry) => ({ value: entry.agent_id, label: `${AGENT_VISUALS[entry.agent_id].glyph} ${entry.display_name}` })),
  ];
  const filterGroups: FilterGroup[] = [
    {
      id: 'status',
      label: 'Status',
      value: statusFilter,
      options: STATUS_OPTIONS,
      onChange: (value) => changeFilter(() => setStatusFilter(value as InvestigationStatus | 'ALL')),
    },
    {
      id: 'verdict',
      label: 'Verdict class',
      value: verdictFilter,
      options: VERDICT_OPTIONS,
      onChange: (value) => changeFilter(() => setVerdictFilter(value as VerdictClass | 'ALL')),
    },
    ...(agentOptions.length > 1
      ? [
          {
            id: 'agent',
            label: 'Primary agent',
            value: agentFilter,
            options: agentOptions,
            onChange: (value: string) => changeFilter(() => setAgentFilter(value as InvestigatorId | 'ALL')),
            // The dataset an investigation reads follows from its primary agent, so the agent's own domain is the dataset hint.
            hint: selectedAgent ? `Reads: ${selectedAgent.domain}` : null,
          },
        ]
      : []),
  ];

  const activeSummary = [
    statusFilter !== 'ALL' ? `status ${STATUS_LABEL[statusFilter]}` : null,
    verdictFilter !== 'ALL' ? `verdict class ${VERDICT_LABEL[verdictFilter]}` : null,
    agentFilter !== 'ALL' ? `primary agent ${agentName(agentFilter)}` : null,
    debouncedQuery !== '' ? `search “${debouncedQuery}”` : null,
  ].filter((part): part is string => part !== null);
  const narrowed = activeSummary.length > 0;

  const canPrev = offset > 0;
  // The list endpoint reports no total, so a full page is the only sign that more may follow.
  const canNext = items.length >= PAGE_SIZE;

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

          <div className="flex shrink-0 flex-wrap items-center gap-3">
            {scenario !== null && (
              <span className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={scenario.canInject === false}
                  title={scenario.canInject === false ? 'Your role does not hold the inject_scenario capability' : undefined}
                  onClick={() => scenario.open()}
                  className={cn(
                    'flex items-center gap-2 rounded bg-primary-container px-3 py-2 font-mono text-xs font-bold uppercase text-on-primary shadow-glow-cyan transition-all hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50',
                    FOCUS_RING,
                  )}
                >
                  <Icon name="admin_panel_settings" size={16} />
                  <span>Inject Scenario</span>
                </button>
                <Proof
                  source="shell: scenario modal · POST /investigations/simulate (wait=false)"
                  n={1}
                  asOf={null}
                  label="Inject scenario"
                  definition="Opens the scenario modal. Authorizing there starts a simulated investigation from a real scenario and opens its debate room. It needs the inject_scenario capability from GET /auth/me."
                />
              </span>
            )}
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

        <HintStrip pageId="investigations" sentences={HINT} className="mt-4" />

        {/* Search and filters */}
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-outline-variant/40 bg-surface-container-low/80 p-3 backdrop-blur-md">
          <div className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">
              <Icon name="travel_explore" size={16} />
            </span>
            <input
              type="search"
              value={query}
              onChange={(event) => changeFilter(() => setQuery(event.target.value))}
              placeholder="Search by case id, verdict class or trigger type…"
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

          <FilterMenu
            groups={filterGroups}
            onClear={clearFilters}
            proof={{
              source: 'GET /investigations?status=&verdict_class=&primary_agent=',
              n: items.length,
              asOf: list.loadedAt,
              definition:
                'Each choice becomes a query parameter, so the server filters the list and the page is fetched again. Nothing is filtered in the browser. The dataset a case reads follows from its primary agent, so the agent choice also selects the dataset.',
            }}
          />
        </div>

        {/* Content: left master list / right detail dossier */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="min-w-0 space-y-3 lg:col-span-7">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 font-mono text-xs text-on-surface-variant">
              <span className="inline-flex flex-wrap items-center gap-2">
                Showing {formatCountNoun(items.length, 'dossier')}
                {narrowed && <span className="text-outline">· filtered by {activeSummary.join(', ')}</span>}
                <Proof
                  source="GET /investigations"
                  n={items.length}
                  asOf={list.loadedAt}
                  label="Dossiers shown"
                  definition={`Rows returned for the current search, filters and page (limit ${formatCount(PAGE_SIZE)}, offset ${formatCount(offset)}). The list endpoint reports no total count, so none is shown; Next is offered when a full page came back.`}
                />
              </span>
              {narrowed && (
                <Button variant="ghost" size="sm" onClick={clearAll}>
                  Clear search and filters
                </Button>
              )}
              {list.error !== null && <span className="text-error">{list.error}</span>}
            </div>

            {list.data === undefined && list.error === null && (
              <div className="space-y-3">
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
              </div>
            )}

            {list.data !== undefined && items.length === 0 &&
              (narrowed || offset > 0 ? (
                <EmptyState
                  icon="travel_explore"
                  title="No investigations match"
                  description="No case matches the current search and filters on this page."
                  action={
                    <Button variant="secondary" onClick={clearAll}>
                      Clear search and filters
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon="travel_explore"
                  title="No investigations yet"
                  description="Cases appear here once a scenario has been run through the three investigators."
                  action={<RunScenarioAction />}
                />
              ))}

            {items.map((item) => {
              const selected = item.id === selectedId;
              const tone = item.verdict_class === null ? statusTone(item.status) : verdictTone(item.verdict_class);
              return (
                <div
                  key={item.id}
                  className={cn(
                    'relative overflow-hidden rounded-xl border p-4 text-left transition-all',
                    selected
                      ? 'border-primary bg-surface-card shadow-glow-cyan ring-1 ring-primary/50'
                      : 'border-outline-variant/40 bg-surface-container-low/70 hover:border-outline-variant hover:bg-surface-card/60',
                  )}
                >
                  {/*
                    The select button comes first and covers the card. The copy and Proof buttons are positioned
                    and later in the DOM, so they paint above it and stay clickable (no button inside a button).
                  */}
                  <button
                    type="button"
                    aria-pressed={selected}
                    aria-label={`Open dossier ${shortId(item.id)}`}
                    onClick={() => setSelectedId(item.id)}
                    className={cn('absolute inset-0 cursor-pointer rounded-xl', FOCUS_RING)}
                  />
                  <span aria-hidden="true" className={cn('pointer-events-none absolute inset-y-0 left-0 w-1', ACCENT[tone])} />
                  <div className="flex flex-col gap-3 pl-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <CopyHash
                          value={item.id}
                          display={shortId(item.id)}
                          label="investigation id"
                          size="inherit"
                          className="text-sm"
                          textClassName="font-bold text-primary"
                        />
                        {item.dataset && (
                          <span className="rounded border border-outline-variant/40 bg-background px-2 py-0.5 font-mono text-[10px] text-on-surface-variant">
                            {item.dataset}
                          </span>
                        )}
                        <StubBadge source={item.data_source} />
                        <Timestamp iso={item.created_at} className="font-mono text-[10px] text-outline" />
                      </div>
                      <h3 className="mt-1 break-words font-headline text-base font-semibold text-on-surface">{item.trigger_type}</h3>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-body text-xs text-on-surface-variant">
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
                          Noise: <code className="text-on-surface">{formatPercentPoints(item.noise_pct)}</code>
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-row flex-wrap items-center gap-x-3 gap-y-1.5 sm:flex-col sm:items-end">
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

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-outline-variant/30 pl-2 pt-2.5 font-mono text-[11px] text-on-surface-variant">
                    <span className="flex items-center gap-1.5">
                      <Icon name="verified_user" size={12} className="text-secondary" />
                      <span>
                        Containment: <strong className="text-on-surface">{formatCount(item.containment_count)}</strong>
                      </span>
                    </span>
                    <span className="text-outline">
                      {formatCountNoun(item.rounds_complete, 'round')} · {STATUS_LABEL[item.status]}
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
                <span>
                  rows {formatCount(offset + 1)}–{formatCount(offset + items.length)}
                </span>
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
          <div className="min-w-0 lg:col-span-5">
            <Dossier dossier={dossier} onChanged={() => setReloadKey((value) => value + 1)} />
          </div>
        </div>
      </section>
    </div>
  );
}
