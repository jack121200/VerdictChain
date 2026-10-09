import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  describeError,
  getAgentFleet,
  getCredibilityHistory,
  getMe,
  getSettings,
  getStats,
  getSystemStatus,
  listCitations,
  updateSettings,
} from '../../api/client';
import type {
  CitationStatus,
  CitationListParams,
  FleetEntry,
  InvestigatorId,
  Metric as MetricEnvelope,
  SettingsUpdate,
} from '../../api/types';
import { useAsync } from '../../app/use-async';
import { AGENT_VISUALS } from '../../lib/agents';
import { cn } from '../../lib/cn';
import { formatNumber, formatPercent, formatTimestamp, shortId } from '../../lib/format';
import { Icon } from '../../ui/Icon';
import { Metric } from '../../ui/Metric';
import { Proof } from '../../ui/Proof';
import { Skeleton } from '../../ui/Skeleton';
import { TrajectoryChart, type TrajectorySeries } from '../../ui/TrajectoryChart';
import { pushToast } from '../../ui/toast-store';
import { VERDICT_LABEL } from '../investigations/labels';
import {
  AGENT_TONE,
  INVESTIGATOR_IDS,
  agentDelta,
  flaggedAgents,
  isolationGauge,
  latestChange,
  overallDelta,
  type HistoryMap,
} from './derive';

const CITE_PAGE_SIZE = 20;

const TONE_TEXT: Record<'primary' | 'secondary' | 'tertiary', string> = {
  primary: 'text-primary',
  secondary: 'text-secondary',
  tertiary: 'text-tertiary',
};
const TONE_BAR: Record<'primary' | 'secondary' | 'tertiary', string> = {
  primary: 'bg-primary',
  secondary: 'bg-secondary',
  tertiary: 'bg-tertiary',
};
const TONE_BOX: Record<'primary' | 'secondary' | 'tertiary', string> = {
  primary: 'border-primary/30 text-primary',
  secondary: 'border-secondary/30 text-secondary',
  tertiary: 'border-tertiary/30 text-tertiary',
};

const STATUS_BADGE: Record<CitationStatus, string> = {
  VERIFIED: 'bg-secondary/15 text-secondary border border-secondary/30',
  DISCREPANCY: 'bg-tertiary/20 text-tertiary border border-tertiary/40',
  INVALID_ROW: 'bg-error-container/40 text-error border border-error/40',
};
const STATUS_ICON: Record<CitationStatus, 'check' | 'warning' | 'close'> = {
  VERIFIED: 'check',
  DISCREPANCY: 'warning',
  INVALID_ROW: 'close',
};

function signed(value: number, decimals = 1): string {
  const pct = (value * 100).toFixed(decimals);
  return value >= 0 ? `+${pct}%` : `${pct}%`;
}

/** Trust & Credibility: Watchdog scoring, trajectory, citation ledger and the real settings configurator (plan 2.7). */
export default function TrustPage() {
  const fleet = useAsync(getAgentFleet, 30_000, ['agents', 'credibility']);
  const settings = useAsync(getSettings, 30_000, ['settings']);
  const status = useAsync(getSystemStatus, 30_000, ['investigations', 'agents', 'settings', 'actions']);
  const stats = useAsync(getStats, 30_000, ['stats', 'investigations', 'actions']);
  const me = useAsync(getMe);
  const histories = useAsync(
    () => Promise.all(INVESTIGATOR_IDS.map((agentId) => getCredibilityHistory(agentId, { limit: 60 }))),
    30_000,
    ['credibility', 'agents'],
  );

  const historyMap = useMemo<HistoryMap>(
    () => ({
      network_traffic: histories.data?.[0] ?? [],
      access_log: histories.data?.[1] ?? [],
      endpoint_behavior: histories.data?.[2] ?? [],
    }),
    [histories.data],
  );

  const fleetList = fleet.data ?? [];
  const nameOf = (agentId: InvestigatorId): string =>
    fleetList.find((entry) => entry.agent_id === agentId)?.display_name ?? agentId;

  const flagged = useMemo(() => new Set(flaggedAgents(historyMap)), [historyMap]);
  const overall = useMemo(() => overallDelta(historyMap), [historyMap]);
  const change = useMemo(() => latestChange(historyMap), [historyMap]);
  const isolated = fleetList.filter((entry) => entry.isolated).length;
  const scoredRounds = INVESTIGATOR_IDS.reduce((total, agentId) => total + historyMap[agentId].length, 0);

  const gauge = useMemo(
    () => (settings.data ? isolationGauge(fleetList, settings.data.isolation_threshold) : null),
    [fleetList, settings.data],
  );

  const series: TrajectorySeries[] = INVESTIGATOR_IDS.map((agentId) => ({
    id: agentId,
    label: nameOf(agentId),
    tone: AGENT_TONE[agentId],
    points: historyMap[agentId].map((row, index) => ({ x: index + 1, y: row.crs_after })),
  }));
  const maxLen = Math.max(1, ...INVESTIGATOR_IDS.map((agentId) => historyMap[agentId].length));

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 text-on-surface lg:px-6">
      <TrustHeader
        meanCrs={stats.data?.mean_crs}
        overall={overall}
        overallAsOf={histories.loadedAt}
        isolated={isolated}
        fleetCount={fleetList.length}
        fleetLoaded={fleet.data !== undefined}
        flaggedCount={flagged.size}
        scoredRounds={scoredRounds}
      />

      {/* 2. Agent credibility scorecards + trajectory */}
      <section className="grid grid-cols-1 items-start gap-5 xl:grid-cols-12">
        <div className="space-y-3.5 xl:col-span-7">
          <div className="flex items-center justify-between pb-1">
            <div className="flex items-center gap-2">
              <Icon name="hub" size={20} className="text-primary" />
              <h2 className="font-headline text-lg font-bold text-on-surface">Agent credibility vectors</h2>
            </div>
            <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase text-on-surface-variant">
              Sample window: {scoredRounds} scored rounds
              <Proof
                source="GET /agents/{id}/credibility-history"
                n={scoredRounds}
                asOf={histories.loadedAt}
                definition="Total credibility_log rows loaded across the three investigators (up to 60 most recent each)."
                label="Sample window"
              />
            </span>
          </div>

          {fleet.data === undefined && fleet.error === null ? (
            <div className="space-y-3.5">
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          ) : (
            fleetList.map((agent) => (
              <AgentScorecard
                key={agent.agent_id}
                agent={agent}
                delta={agentDelta(historyMap[agent.agent_id])}
                flagged={flagged.has(agent.agent_id)}
                asOf={fleet.loadedAt}
              />
            ))
          )}
          {fleet.error && !fleet.data && <p className="font-mono text-xs text-error">{fleet.error}</p>}
        </div>

        {/* Trajectory */}
        <div className="space-y-4 rounded-xl border border-outline-variant/40 bg-surface-container-low p-4 shadow-md xl:col-span-5">
          <div className="space-y-0.5">
            <h3 className="font-headline text-base font-bold text-on-surface">Credibility trajectory</h3>
            <span className="font-mono text-[10px] uppercase text-on-surface-variant">
              CrS after each scored round · credibility_log
            </span>
          </div>
          <div className="rounded-lg border border-outline-variant/30 bg-background p-3 shadow-inner">
            <TrajectoryChart
              label="Credibility trajectory for the three investigators"
              series={series}
              xDomain={[1, maxLen]}
              yDomain={[0, 1]}
              threshold={
                settings.data ? { value: settings.data.isolation_threshold, label: 'Isolation threshold' } : undefined
              }
              xLabel="Scored round (chronological)"
              yLabel="CrS"
              proof={{
                source: 'GET /agents/{id}/credibility-history crs_after · GET /settings.isolation_threshold',
                n: scoredRounds,
                asOf: histories.loadedAt,
                definition:
                  'Credibility after each scored round, oldest to newest, from credibility_log. The dashed line is the live isolation threshold.',
              }}
            />
          </div>
          <div className="space-y-1 rounded-lg border border-outline-variant/30 bg-surface-card p-3">
            <div className="flex items-center justify-between text-on-surface">
              <span className="flex items-center gap-1.5 font-mono text-xs font-semibold uppercase text-primary">
                <Icon name="sync_alt" size={16} />
                Latest credibility adjustment
              </span>
              <span className="font-mono text-[10px] font-bold uppercase text-secondary">
                {change ? 'from log' : 'no data'}
              </span>
            </div>
            <p className="font-body text-xs leading-relaxed text-on-surface-variant">
              {change ? (
                <>
                  {nameOf(change.agent)} moved{' '}
                  <span className={change.delta >= 0 ? 'text-secondary' : 'text-error'}>{signed(change.delta)}</span> after
                  round {change.round}; Watchdog match rate {formatPercent(change.matchRate)} ({formatTimestamp(change.at)}).
                </>
              ) : (
                'No scored rounds yet. Credibility adjustments appear here after an investigator is scored in a debate.'
              )}
            </p>
          </div>
        </div>
      </section>

      {/* 3. Mechanism + isolation protocol */}
      <section className="grid grid-cols-1 items-stretch gap-5 lg:grid-cols-12">
        <MechanismCard />
        <IsolationProtocol gauge={gauge} nameOf={nameOf} asOf={settings.loadedAt} settingsLoaded={settings.data !== undefined} />
      </section>

      {/* 4. Citation validation ledger */}
      <CitationLedger nameOf={nameOf} />

      {/* 5. Policy configurator */}
      <PolicyConfigurator
        settings={settings.data}
        settingsUpdatedBy={settings.data?.updated_by ?? null}
        settingsUpdatedAt={settings.data?.updated_at ?? null}
        canEdit={me.data?.capabilities.includes('edit_settings') ?? false}
        sandboxViolations={status.data?.sandbox.is_simulated_violations}
        onApplied={settings.reload}
      />
    </div>
  );
}

// ---- Section 1: header ---------------------------------------------------------

function StatusTile({
  tone,
  label,
  children,
  sub,
}: {
  tone: 'primary' | 'secondary' | 'tertiary';
  label: string;
  children: ReactNode;
  sub: ReactNode;
}) {
  return (
    <div
      className={cn(
        'min-w-[140px] rounded-xl border bg-surface-container-low px-4 py-3 shadow-md',
        tone === 'tertiary' ? 'border-tertiary/30' : 'border-outline-variant/40',
      )}
    >
      <span className="block font-mono text-[10px] font-semibold uppercase text-on-surface-variant">{label}</span>
      <div className="mt-1 flex items-baseline gap-1">{children}</div>
      <span className="mt-1 block font-mono text-[10px] font-semibold uppercase text-on-surface-variant">{sub}</span>
    </div>
  );
}

function TrustHeader({
  meanCrs,
  overall,
  overallAsOf,
  isolated,
  fleetCount,
  fleetLoaded,
  flaggedCount,
  scoredRounds,
}: {
  meanCrs: MetricEnvelope<number> | undefined;
  overall: { value: number | null; n: number };
  overallAsOf: string | null;
  isolated: number;
  fleetCount: number;
  fleetLoaded: boolean;
  flaggedCount: number;
  scoredRounds: number;
}) {
  return (
    <section className="relative w-full space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-mono text-[10px]">
          <span className="h-2 w-2 animate-pulse rounded-full bg-secondary" aria-hidden="true" />
          <span className="font-semibold uppercase tracking-widest text-secondary">
            Watchdog auditor // Continuous credibility scoring
          </span>
          <span className="text-outline-variant">/</span>
          <span className="uppercase text-on-surface-variant">Out-of-band, deterministic</span>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-outline-variant/40 bg-surface-card px-3 py-1 font-mono text-[11px] shadow-sm">
          <Icon name="verified_user" size={16} className="text-primary" />
          <span className="font-semibold uppercase text-primary">Deterministic citation verification</span>
        </div>
      </div>

      <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
        <div className="max-w-3xl space-y-2">
          <h1 className="font-headline text-2xl font-bold tracking-tight text-on-surface sm:text-3xl lg:text-4xl">
            Watchdog continuous credibility scoring
          </h1>
          <div className="inline-flex items-center gap-2 rounded-full border border-outline-variant/40 bg-surface-container-high px-3 py-1 shadow-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-primary-container" aria-hidden="true" />
            <p className="font-body text-xs text-on-surface-variant">
              Scores each investigator's reliability by cross-checking its cited evidence against the raw logs — ground-truth
              labels are never shown to an agent during the debate.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <StatusTile
            tone="primary"
            label="Overall reliability"
            sub={
              <span className="inline-flex items-center gap-1 normal-case">
                <span className={overall.value === null ? 'text-on-surface-variant' : overall.value >= 0 ? 'text-secondary' : 'text-error'}>
                  {overall.value === null ? 'no cycle yet' : `${signed(overall.value)} this cycle`}
                </span>
                <Proof
                  source="browser: GET /agents/{id}/credibility-history (crs_after − crs_before)"
                  n={overall.n}
                  asOf={overallAsOf}
                  definition="Mean of each investigator's most-recent scored-round credibility delta. Positive means credibility rose this cycle."
                  label="Reliability delta"
                />
              </span>
            }
          >
            <Metric
              size="kpi"
              className="text-primary"
              label="Overall reliability (mean CrS)"
              metric={meanCrs}
              format={(value) => formatPercent(value, 1)}
            />
          </StatusTile>

          <StatusTile
            tone="secondary"
            label="Quarantined"
            sub={<span>{isolated === 0 ? 'none isolated' : 'isolated now'}</span>}
          >
            <span className="font-headline text-3xl font-bold tracking-tighter text-secondary">
              {fleetLoaded ? isolated : '—'}
            </span>
            <span className="text-sm font-bold text-secondary">/{fleetLoaded ? fleetCount : '—'}</span>
            <Proof
              source="GET /agents/fleet.isolated"
              n={fleetCount}
              asOf={null}
              definition="Count of investigators currently quarantined (isolated = true) out of the three investigators."
              label="Quarantined agents"
            />
          </StatusTile>

          <StatusTile tone="tertiary" label="Flagged warnings" sub={<span>recent discrepancy</span>}>
            <span className="font-headline text-3xl font-bold tracking-tighter text-tertiary">{flaggedCount}</span>
            <span className="text-sm font-bold text-tertiary">{flaggedCount === 1 ? 'agent' : 'agents'}</span>
            <Proof
              source="browser: GET /agents/{id}/credibility-history verification_match_rate"
              n={scoredRounds}
              asOf={null}
              definition="Investigators with at least one discrepancy (verification_match_rate < 1) in their last 10 scored rounds."
              label="Flagged warnings"
            />
          </StatusTile>
        </div>
      </div>
    </section>
  );
}

// ---- Section 2: agent scorecards -----------------------------------------------

function AgentScorecard({
  agent,
  delta,
  flagged,
  asOf,
}: {
  agent: FleetEntry;
  delta: number | null;
  flagged: boolean;
  asOf: string | null;
}) {
  const tone = AGENT_TONE[agent.agent_id];
  const crs = agent.crs.value;
  const statusLabel = agent.isolated ? 'Quarantined' : flagged ? 'Flagged // desync' : 'Synchronized';
  const statusClass = agent.isolated
    ? 'bg-error-container/40 text-error border-error/40'
    : flagged
      ? 'bg-tertiary/15 text-tertiary border-tertiary/30'
      : 'bg-secondary/10 text-secondary border-secondary/30';
  const borderClass = flagged ? 'border-tertiary/40' : agent.isolated ? 'border-error/40' : 'border-outline-variant/40';

  return (
    <div className={cn('rounded-xl border bg-surface-container-low p-4 shadow-md transition-all hover:bg-surface-card', borderClass)}>
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg border bg-surface-container-high font-mono text-lg', TONE_BOX[tone])}>
            {AGENT_VISUALS[agent.agent_id].glyph}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-headline text-base font-semibold text-on-surface">{agent.display_name}</span>
              <span className={cn('rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase', statusClass)}>
                {statusLabel}
              </span>
            </div>
            <span className="font-mono text-[10px] text-on-surface-variant">
              {agent.model ?? 'model not configured'}
              {agent.provider_chain.length > 0 && ` · ${agent.provider_chain.join(' → ')}`}
            </span>
          </div>
        </div>
        <div className="flex items-baseline gap-1 font-mono sm:text-right">
          <Metric size="body" className={TONE_TEXT[tone]} label={`Credibility, ${agent.display_name}`} metric={agent.crs} format={(value) => formatPercent(value, 1)} />
          {delta !== null && (
            <span className={cn('ml-1 text-[10px] font-semibold', delta >= 0 ? 'text-secondary' : 'text-error')}>{signed(delta)}</span>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high">
          <div className={cn('h-full rounded-full', TONE_BAR[tone])} style={{ width: `${crs === null ? 0 : Math.round(crs * 100)}%` }} />
        </div>
        <div className="grid grid-cols-3 gap-2 pt-1 font-mono text-xs">
          <div>
            <span className="block text-[10px] uppercase text-on-surface-variant">Verified citations</span>
            <span className="font-semibold text-on-surface">
              {agent.citations_verified.value ?? '—'} / {agent.citations_total.value ?? '—'}
            </span>
          </div>
          <div>
            <span className="block text-[10px] uppercase text-on-surface-variant">Invalid citation rate</span>
            <span className="inline-flex items-center gap-1">
              <Metric size="body" className={tone === 'tertiary' ? 'text-tertiary' : 'text-secondary'} label={`Invalid-citation rate, ${agent.display_name}`} metric={agent.invalid_rate} format={(value) => formatPercent(value, 1)} />
            </span>
          </div>
          <div>
            <span className="block text-[10px] uppercase text-on-surface-variant">Last vote class</span>
            <span className="font-semibold text-on-surface">{agent.last_vote === null ? 'no vote yet' : VERDICT_LABEL[agent.last_vote]}</span>
          </div>
        </div>
      </div>
      <div className="mt-2 flex justify-end">
        <Proof
          source="GET /agents/fleet"
          n={agent.rounds_scored.value ?? 0}
          asOf={asOf}
          definition="CrS, verified/total citations, invalid-citation rate and last vote class for this investigator. The change shown is its most-recent scored-round movement (crs_after − crs_before). Model and provider chain are read from config."
          label={`${agent.display_name} scorecard`}
        />
      </div>
    </div>
  );
}

// ---- Section 3: mechanism + isolation ------------------------------------------

function MechanismCard() {
  return (
    <div className="flex flex-col justify-between space-y-4 rounded-xl border border-outline-variant/40 bg-surface-container-low p-5 shadow-md lg:col-span-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="rounded border border-primary-container/40 bg-primary-container/20 px-2 py-0.5 font-bold uppercase text-primary">
            How it works
          </span>
          <span className="uppercase text-on-surface-variant">Watchdog credibility scoring · deterministic, no LLM</span>
        </div>
        <h3 className="font-headline text-xl font-bold text-on-surface">Credibility scoring, end to end</h3>
        <p className="font-body text-xs leading-relaxed text-on-surface-variant sm:text-sm">
          Every claim an investigator makes must cite a specific raw-log row. An out-of-band Watchdog re-queries each cited
          row against raw_logs in PostgreSQL and compares field values exactly. The match rate feeds the credibility score
          with the formula CrS = clamp(c · (1 + η · (2·rate − 1)), 0, 1). Agents cannot raise each other's credibility by
          agreeing — only verified evidence moves it.
        </p>
        <div className="grid grid-cols-1 gap-4 pt-2 md:grid-cols-2">
          <div className="space-y-1 rounded-lg border border-outline-variant/40 bg-surface-card p-3">
            <div className="flex items-center gap-1.5 text-primary">
              <Icon name="receipt_long" size={16} />
              <span className="font-mono text-xs font-semibold uppercase">What the Watchdog checks</span>
            </div>
            <p className="font-body text-xs leading-relaxed text-on-surface-variant">
              Each citation is re-queried by row id. An exact field match is VERIFIED; a different value is a DISCREPANCY; a
              missing or malformed row is INVALID_ROW. The check is plain SQL, never another model.
            </p>
          </div>
          <div className="space-y-1 rounded-lg border border-outline-variant/40 bg-surface-card p-3">
            <div className="flex items-center gap-1.5 text-secondary">
              <Icon name="verified_user" size={16} />
              <span className="font-mono text-xs font-semibold uppercase">What agents can and cannot see</span>
            </div>
            <p className="font-body text-xs leading-relaxed text-on-surface-variant">
              In rounds 2 and 3 agents see each other's theories and self-reported confidence, but never each other's raw
              rows, and never the scenario's ground-truth label. The blind property is checked in code.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-outline-variant/30 pt-3 font-mono text-[10px] text-on-surface-variant">
        <span className="flex items-center gap-1.5">
          <Icon name="check_circle" size={16} className="text-secondary" /> Citations re-checked against raw_logs
        </span>
        <span className="flex items-center gap-1.5">
          <Icon name="check_circle" size={16} className="text-secondary" /> Ground-truth blinded during debate
        </span>
        <span className="inline-flex items-center gap-1 font-semibold text-primary">
          Blind-test proof
          <Proof
            source="backend/tests/agents/test_blind_boundary.py"
            n={1}
            asOf={null}
            definition="The blind property is a checked test: an AST scan, a seeded-secret test and a prompt test prove the scenario ground-truth label never reaches any investigator's inputs."
            label="Blind-test proof location"
          />
        </span>
      </div>
    </div>
  );
}

function IsolationProtocol({
  gauge,
  nameOf,
  asOf,
  settingsLoaded,
}: {
  gauge: ReturnType<typeof isolationGauge> | null;
  nameOf: (agentId: InvestigatorId) => string;
  asOf: string | null;
  settingsLoaded: boolean;
}) {
  const thresholdPct = gauge ? Math.round(gauge.threshold * 100) : 0;
  return (
    <div className="flex flex-col justify-between space-y-4 rounded-xl border border-outline-variant/40 bg-surface-container-low p-5 shadow-md lg:col-span-4">
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="font-headline text-base font-bold text-on-surface">Isolation protocol</span>
          <span className="rounded border border-error/30 bg-error-container/40 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-error">
            Auto-quarantine
          </span>
        </div>
        <p className="font-body text-xs text-on-surface-variant">
          An investigator whose CrS falls below the isolation threshold after a round is quarantined and excluded from the
          rest of the debate and from the verdict.
        </p>
      </div>

      <div className="space-y-2 py-2">
        <div className="flex items-center justify-between font-mono text-[10px] font-semibold uppercase">
          <span className="text-error">Quarantine &lt; {settingsLoaded ? `${thresholdPct}%` : '—'}</span>
          <span className="text-secondary">Active ≥ {settingsLoaded ? `${thresholdPct}%` : '—'}</span>
        </div>
        <div className="relative flex h-4 w-full overflow-hidden rounded-full border border-outline-variant/40 bg-surface-container-high">
          <div className="h-full bg-error-container/50" style={{ width: `${thresholdPct}%` }}>
            <span className="flex h-full items-center justify-center font-mono text-[9px] font-bold tracking-widest text-on-error-container">
              QUARANTINE
            </span>
          </div>
          <div className="h-full flex-1 bg-secondary-container/40" />
          {gauge?.minCrs != null && (
            <span
              className="absolute top-0 h-full w-0.5 bg-on-surface"
              style={{ left: `${Math.min(100, Math.max(0, Math.round(gauge.minCrs * 100)))}%` }}
              aria-hidden="true"
            />
          )}
        </div>

        <div className="space-y-0.5 font-mono text-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase text-on-surface-variant">Lowest current agent</span>
            <span className="font-bold text-tertiary">
              {gauge?.minAgent ? `${nameOf(gauge.minAgent)}: ${formatPercent(gauge.minCrs ?? 0, 1)}` : '—'}
            </span>
          </div>
          <p className="flex items-center gap-1 font-body text-xs text-on-surface-variant">
            Safety margin:{' '}
            <span className={gauge?.margin == null ? 'text-on-surface-variant' : gauge.margin >= 0 ? 'font-semibold text-secondary' : 'font-semibold text-error'}>
              {gauge?.margin == null ? '—' : signed(gauge.margin)}
            </span>{' '}
            vs quarantine threshold
            <Proof
              source="browser: GET /agents/fleet.crs · GET /settings.isolation_threshold"
              n={1}
              asOf={asOf}
              definition="Lowest investigator CrS and its margin above the isolation threshold (minCrs − threshold). Below the threshold the agent is quarantined."
              label="Isolation margin"
            />
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-outline-variant/30 bg-surface-card p-3">
        <Icon name="verified_user" size={20} className="text-secondary" />
        <div className="flex flex-col">
          <span className="font-mono text-xs font-semibold uppercase text-on-surface">Per-agent context isolation</span>
          <span className="font-mono text-[10px] text-on-surface-variant">
            Each investigator reasons over its own log slice; raw rows stay private to that agent.
          </span>
        </div>
      </div>
    </div>
  );
}

// ---- Section 4: citation ledger ------------------------------------------------

const CITE_FILTERS: ReadonlyArray<{ value: CitationStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'VERIFIED', label: 'Verified' },
  { value: 'DISCREPANCY', label: 'Discrepancies' },
  { value: 'INVALID_ROW', label: 'Invalid' },
];

function CitationLedger({ nameOf }: { nameOf: (agentId: InvestigatorId) => string }) {
  const [filter, setFilter] = useState<CitationStatus | 'ALL'>('ALL');
  const [offset, setOffset] = useState(0);

  const params = useMemo<CitationListParams>(
    () => ({ limit: CITE_PAGE_SIZE, offset, status: filter === 'ALL' ? undefined : filter }),
    [filter, offset],
  );
  const page = useAsync(() => listCitations(params), undefined, ['credibility', 'investigations']);
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
  const total = page.data?.total;
  const canPrev = offset > 0;
  const canNext = total?.value != null && offset + items.length < total.value;

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
                <td className="px-3 py-2.5 font-semibold text-primary">{shortId(row.row_id)}</td>
                <td className="px-3 py-2.5">
                  <span className="flex items-center gap-2 text-on-surface">
                    <span className={cn('h-1.5 w-1.5 rounded-full', TONE_BAR[AGENT_TONE[row.agent_id]])} aria-hidden="true" />
                    {nameOf(row.agent_id)}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-on-surface-variant">
                  <span className="text-on-surface">
                    {row.field}={row.value ?? '∅'}
                  </span>
                  <span className="block text-[10px] uppercase text-outline">
                    inv {shortId(row.investigation_id)} · r{row.round}
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
            {page.data !== undefined && items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-on-surface-variant">
                  No citations match this filter yet.
                </td>
              </tr>
            )}
            {page.data === undefined && page.error === null && (
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
          Displaying {items.length} of
          <Metric size="body" label="Total citations matching the filter" metric={total} />
          checked citations
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
          <span className="px-2 font-bold text-primary">offset {offset}</span>
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

// ---- Section 5: policy configurator --------------------------------------------

interface SettingsView {
  eta: number;
  isolation_threshold: number;
  verdict_confidence_threshold: number;
  intake_paused: boolean;
}

function PolicyConfigurator({
  settings,
  settingsUpdatedBy,
  settingsUpdatedAt,
  canEdit,
  sandboxViolations,
  onApplied,
}: {
  settings: SettingsView | undefined;
  settingsUpdatedBy: string | null;
  settingsUpdatedAt: string | null;
  canEdit: boolean;
  sandboxViolations: MetricEnvelope<number> | undefined;
  onApplied: () => void;
}) {
  const [draft, setDraft] = useState<SettingsUpdate | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings) {
      setDraft((prev) =>
        prev ?? {
          eta: settings.eta,
          isolation_threshold: settings.isolation_threshold,
          verdict_confidence_threshold: settings.verdict_confidence_threshold,
          intake_paused: settings.intake_paused,
        },
      );
    }
  }, [settings]);

  function reset() {
    if (!settings) return;
    setDraft({
      eta: settings.eta,
      isolation_threshold: settings.isolation_threshold,
      verdict_confidence_threshold: settings.verdict_confidence_threshold,
      intake_paused: settings.intake_paused,
    });
  }

  async function apply() {
    if (!draft) return;
    setBusy(true);
    try {
      const next = await updateSettings(draft);
      setDraft({
        eta: next.eta,
        isolation_threshold: next.isolation_threshold,
        verdict_confidence_threshold: next.verdict_confidence_threshold,
        intake_paused: next.intake_paused,
      });
      onApplied();
      pushToast('Runtime settings updated (audited).', { tone: 'secondary' });
    } catch (error) {
      pushToast(describeError(error), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5 rounded-xl border border-outline-variant/40 bg-surface-container-low p-5 shadow-md">
      <div className="flex flex-col justify-between gap-3 border-b border-outline-variant/30 pb-2 md:flex-row md:items-center">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Icon name="admin_panel_settings" size={20} className="text-secondary" />
            <h2 className="font-headline text-base font-bold text-on-surface">Runtime policy configurator</h2>
          </div>
          <p className="font-body text-xs text-on-surface-variant">
            The three editable runtime thresholds. Apply and reset call PUT /settings, which is RBAC-gated and audited.
            Containment actions always run in a sandbox.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-secondary/30 bg-secondary-container/20 px-3 py-1 font-mono text-[10px] font-semibold uppercase text-secondary shadow-sm">
          <span className="h-2 w-2 rounded-full bg-secondary" aria-hidden="true" />
          <span className="inline-flex items-center gap-1">
            Sandbox violations:
            <Metric size="body" className="text-secondary" label="Sandbox simulated-violation count" metric={sandboxViolations} />
          </span>
        </div>
      </div>

      {!canEdit ? (
        <div className="space-y-3">
          <p className="rounded-lg border border-outline-variant/40 bg-surface-card p-3 font-body text-xs text-on-surface-variant">
            Editing runtime settings requires the <code className="font-mono text-on-surface">edit_settings</code> capability.
            The current values are read-only for your role.
          </p>
          <div className="grid grid-cols-1 gap-4 font-mono text-xs md:grid-cols-3">
            <ReadOnlyValue label="Learning rate η" value={settings ? formatNumber(settings.eta, 2) : '—'} />
            <ReadOnlyValue label="Isolation threshold" value={settings ? formatPercent(settings.isolation_threshold, 0) : '—'} />
            <ReadOnlyValue label="Verdict confidence floor" value={settings ? formatPercent(settings.verdict_confidence_threshold, 0) : '—'} />
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <PolicySlider
              label="Learning rate η"
              description="How strongly each round's verification result moves an agent's credibility (compute_crs)."
              value={draft?.eta ?? 0}
              min={0.01}
              max={0.5}
              step={0.01}
              accent="primary"
              display={(value) => formatNumber(value, 2)}
              ticks={['0.01', '0.15', '0.50']}
              disabled={draft === null}
              onChange={(value) => setDraft((prev) => (prev ? { ...prev, eta: value } : prev))}
              proof="GET /settings.eta · PUT /settings"
              proofDef="Credibility learning rate η in [0.01, 0.5]. Used by compute_crs = clamp(c·(1 + η·(2·rate − 1)), 0, 1)."
            />
            <PolicySlider
              label="Isolation threshold"
              description="CrS below this value after a round quarantines the investigator for the rest of the debate."
              value={draft?.isolation_threshold ?? 0}
              min={0.05}
              max={0.45}
              step={0.01}
              accent="secondary"
              display={(value) => formatPercent(value, 0)}
              ticks={['5%', '25%', '45%']}
              disabled={draft === null}
              onChange={(value) => setDraft((prev) => (prev ? { ...prev, isolation_threshold: value } : prev))}
              proof="GET /settings.isolation_threshold · PUT /settings"
              proofDef="Isolation threshold in [0.05, 0.45]. An agent below it after a round is quarantined and excluded from the verdict."
            />
            <PolicySlider
              label="Verdict confidence floor"
              description="Minimum aggregate confidence for a non-ambiguous verdict; below it the verdict is ambiguous."
              value={draft?.verdict_confidence_threshold ?? 0}
              min={0.5}
              max={0.99}
              step={0.01}
              accent="primary"
              display={(value) => formatPercent(value, 0)}
              ticks={['50%', '80%', '99%']}
              disabled={draft === null}
              onChange={(value) => setDraft((prev) => (prev ? { ...prev, verdict_confidence_threshold: value } : prev))}
              proof="GET /settings.verdict_confidence_threshold · PUT /settings"
              proofDef="Verdict confidence threshold in [0.50, 0.99]. The aggregate must reach it for a non-ambiguous verdict."
            />
          </div>

          <div className="flex flex-col justify-between gap-3 border-t border-outline-variant/30 pt-2 sm:flex-row sm:items-center">
            <div className="flex items-center gap-1.5 font-mono text-[10px] text-on-surface-variant">
              <Icon name="verified_user" size={16} className="text-primary" />
              <span>
                Last changed by {settingsUpdatedBy ?? 'system'}
                {settingsUpdatedAt ? ` · ${formatTimestamp(settingsUpdatedAt)}` : ' · not yet changed'}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={reset}
                disabled={busy || draft === null}
                className="cursor-pointer rounded border border-outline-variant/40 bg-surface-card px-4 py-1.5 font-mono text-xs uppercase text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:opacity-50"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={apply}
                disabled={busy || draft === null}
                className="flex cursor-pointer items-center gap-1.5 rounded bg-primary-container px-4 py-1.5 font-mono text-xs font-bold uppercase text-on-primary shadow-glow-cyan transition-all hover:bg-primary disabled:opacity-50"
              >
                <Icon name="sync_alt" size={16} className={busy ? 'animate-spin' : undefined} />
                <span>{busy ? 'Applying…' : 'Apply settings'}</span>
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function ReadOnlyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-card p-4">
      <span className="block text-[10px] font-semibold uppercase text-on-surface-variant">{label}</span>
      <span className="mt-1 block text-primary">{value}</span>
    </div>
  );
}

function PolicySlider({
  label,
  description,
  value,
  min,
  max,
  step,
  accent,
  display,
  ticks,
  disabled,
  onChange,
  proof,
  proofDef,
}: {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step: number;
  accent: 'primary' | 'secondary';
  display: (value: number) => string;
  ticks: [string, string, string];
  disabled: boolean;
  onChange: (value: number) => void;
  proof: string;
  proofDef: string;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface-card p-4">
      <div className="flex items-center justify-between font-mono text-xs">
        <span className="font-semibold uppercase text-on-surface">{label}</span>
        <span className="inline-flex items-center gap-1">
          <span className={cn('font-bold', accent === 'primary' ? 'text-primary' : 'text-secondary')}>{display(value)}</span>
          <Proof source={proof} n={1} asOf={null} definition={proofDef} label={label} />
        </span>
      </div>
      <p className="font-body text-xs text-on-surface-variant">{description}</p>
      <div className="space-y-1">
        <input
          type="range"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
          className={cn(
            'h-1.5 w-full cursor-pointer rounded-lg bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50',
            accent === 'primary' ? 'accent-primary-container' : 'accent-secondary',
          )}
        />
        <div className="flex justify-between font-mono text-[9px] text-on-surface-variant">
          <span>{ticks[0]}</span>
          <span>{ticks[1]}</span>
          <span>{ticks[2]}</span>
        </div>
      </div>
    </div>
  );
}
