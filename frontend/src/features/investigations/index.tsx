import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { AGENT_VISUALS } from '../../lib/agents';
import { cn } from '../../lib/cn';
import { formatTimestamp, shortId } from '../../lib/format';
import { AgentChip } from '../../ui/AgentChip';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { Metric } from '../../ui/Metric';
import { Pill } from '../../ui/Pill';
import { Select } from '../../ui/Select';
import { Skeleton } from '../../ui/Skeleton';
import { FOCUS_RING, type Tone } from '../../ui/classes';
import { Dossier, type DossierData, type Loaded } from './Dossier';
import { STATUS_LABEL, VERDICT_LABEL, statusTone, verdictIcon, verdictTone, type PillTone } from './labels';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

const ACCENT: Record<PillTone, string> = {
  primary: 'bg-primary',
  secondary: 'bg-secondary',
  tertiary: 'bg-tertiary',
  error: 'bg-error',
  neutral: 'bg-outline',
};

const STATUS_OPTIONS: ReadonlyArray<{ value: InvestigationStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'running', label: STATUS_LABEL.running },
  { value: 'verdict_reached', label: STATUS_LABEL.verdict_reached },
  { value: 'contained', label: STATUS_LABEL.contained },
  { value: 'ambiguous', label: STATUS_LABEL.ambiguous },
  { value: 'failed', label: STATUS_LABEL.failed },
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

  const fleet = useAsync(getAgentFleet);

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

  const list = useAsync(() => listInvestigations(params));
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

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-6">
      <header className="flex flex-col gap-2 border-b border-outline-variant/40 pb-6">
        <span className="flex items-center gap-2 text-label uppercase text-primary">
          <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-primary" aria-hidden="true" />
          Forensic dossiers
        </span>
        <h1 className="font-headline text-h1 tracking-tight text-on-surface sm:text-h1-sm">Investigations</h1>
        <p className="max-w-2xl text-body text-on-surface-variant">
          Cases from the multi-agent debate. Every value below is an API field or a derivation documented in its Proof. No
          case ids, hashes or hosts are typed in.
        </p>
      </header>

      {/* Filters */}
      <div className="mt-6 flex flex-col gap-3 rounded-xl border border-outline-variant/40 bg-surface-container-low/80 p-3 backdrop-blur-md lg:flex-row lg:items-end">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">
            <Icon name="travel_explore" size={16} />
          </span>
          <input
            type="search"
            value={query}
            onChange={(event) => changeFilter(() => setQuery(event.target.value))}
            placeholder="Search by id, verdict or trigger…"
            aria-label="Search investigations"
            className={cn(
              'w-full rounded-lg border border-outline-variant/60 bg-background py-2 pl-9 pr-3 font-mono text-evidence text-on-surface placeholder:text-outline focus:border-primary focus:outline-none',
              FOCUS_RING,
            )}
          />
        </div>
        <Select
          label="Status"
          value={statusFilter}
          options={STATUS_OPTIONS}
          onChange={(value) => changeFilter(() => setStatusFilter(value))}
        />
        <Select
          label="Verdict"
          value={verdictFilter}
          options={VERDICT_OPTIONS}
          onChange={(value) => changeFilter(() => setVerdictFilter(value))}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-label uppercase text-on-surface-variant">Primary agent</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <AgentFilterButton active={agentFilter === 'ALL'} onClick={() => changeFilter(() => setAgentFilter('ALL'))}>
              All
            </AgentFilterButton>
            {agentOptions.map((entry) => (
              <AgentFilterButton
                key={entry.agent_id}
                active={agentFilter === entry.agent_id}
                tone={toneForAgent(entry.agent_id)}
                onClick={() => changeFilter(() => setAgentFilter(entry.agent_id))}
              >
                {AGENT_VISUALS[entry.agent_id].glyph} {entry.display_name}
              </AgentFilterButton>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: list */}
        <div className="space-y-3 lg:col-span-7">
          <div className="flex items-center justify-between px-1 text-caption text-on-surface-variant">
            <span className="inline-flex items-center gap-2">
              Showing {items.length} of
              <Metric size="body" label="Total investigations matching the filters" metric={total} />
              dossiers
            </span>
            {list.error !== null && <span className="text-error">{list.error}</span>}
          </div>

          {list.data === undefined && list.error === null && (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
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
              <button
                key={item.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setSelectedId(item.id)}
                className={cn(
                  'relative w-full overflow-hidden rounded-xl border p-4 pl-5 text-left transition-colors',
                  selected
                    ? 'border-primary bg-surface-card shadow-glow-cyan'
                    : 'border-outline-variant/40 bg-surface-container-low/70 hover:border-outline-variant',
                  FOCUS_RING,
                )}
              >
                <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-1', ACCENT[tone])} />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-evidence font-semibold text-primary">{shortId(item.id)}</span>
                      {item.dataset && (
                        <span className="rounded border border-outline-variant/40 bg-background px-1.5 py-0.5 font-mono text-evidence text-on-surface-variant">
                          {item.dataset}
                        </span>
                      )}
                      <span className="font-mono text-evidence text-on-surface-variant">{formatTimestamp(item.created_at)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {item.primary_agent && <AgentChip agentId={item.primary_agent} name={agentName(item.primary_agent)} />}
                      <span className="font-mono text-evidence text-on-surface-variant">{item.trigger_type}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {item.verdict_class !== null ? (
                      <Pill tone={verdictTone(item.verdict_class)} icon={verdictIcon(item.verdict_class)}>
                        {VERDICT_LABEL[item.verdict_class]}
                      </Pill>
                    ) : (
                      <Pill tone={statusTone(item.status)}>{STATUS_LABEL[item.status]}</Pill>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-outline-variant/40 pt-2 text-caption text-on-surface-variant">
                  <span className="inline-flex items-center gap-1.5">
                    <Icon name="verified_user" size={12} className="text-secondary" />
                    Containment: <span className="font-mono text-evidence text-on-surface">{item.containment_count}</span>
                  </span>
                  <span className="font-mono text-evidence">
                    {item.rounds_complete} rounds · {STATUS_LABEL[item.status]}
                  </span>
                </div>
              </button>
            );
          })}

          {(canPrev || canNext) && (
            <div className="flex items-center justify-between px-1 pt-1 text-caption text-on-surface-variant">
              <button
                type="button"
                disabled={!canPrev}
                onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}
                className={cn('rounded px-2 py-1 uppercase disabled:opacity-40', canPrev && 'hover:text-on-surface', FOCUS_RING)}
              >
                Previous
              </button>
              <span className="font-mono text-evidence">offset {offset}</span>
              <button
                type="button"
                disabled={!canNext}
                onClick={() => setOffset((value) => value + PAGE_SIZE)}
                className={cn('rounded px-2 py-1 uppercase disabled:opacity-40', canNext && 'hover:text-on-surface', FOCUS_RING)}
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
    </div>
  );
}

function toneForAgent(agentId: InvestigatorId): Tone {
  const tone = AGENT_VISUALS[agentId].tone;
  return tone === 'primary-container' ? 'primary' : tone;
}

function AgentFilterButton({
  active,
  tone = 'primary',
  onClick,
  children,
}: {
  active: boolean;
  tone?: Tone;
  onClick: () => void;
  children: ReactNode;
}) {
  const ACTIVE: Record<Tone, string> = {
    primary: 'border-primary bg-primary/10 text-primary',
    secondary: 'border-secondary bg-secondary/10 text-secondary',
    tertiary: 'border-tertiary bg-tertiary/10 text-tertiary',
    error: 'border-error bg-error-container/30 text-error',
  };
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'cursor-pointer rounded border px-2 py-1 text-label uppercase transition-colors',
        active ? ACTIVE[tone] : 'border-outline-variant/40 bg-surface-card text-on-surface-variant hover:text-on-surface',
        FOCUS_RING,
      )}
    >
      {children}
    </button>
  );
}
