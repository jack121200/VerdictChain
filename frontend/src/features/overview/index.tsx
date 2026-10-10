import { useMemo, type ReactNode } from 'react';
import {
  getAgentFleet,
  getEvaluation,
  getInvestigationCitations,
  getRawLogCounts,
  getSettings,
  getStats,
  getSystemStatus,
  listAuditTrail,
  listInvestigations,
  listRecentRawLogs,
  listScenarios,
} from '../../api/client';
import type { CitationStatus, Metric as MetricEnvelope } from '../../api/types';
import { useAsync } from '../../app/use-async';
import { buildRoute } from '../../app/router';
import { cn } from '../../lib/cn';
import { cssPercent, formatCount, formatCountNoun, formatDuration, formatNumber, formatOutOf, formatPercent } from '../../lib/format';
import { AgentChip } from '../../ui/AgentChip';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icon-names';
import { Metric } from '../../ui/Metric';
import { Proof } from '../../ui/Proof';
import { Timestamp } from '../../ui/Timestamp';
import { deriveMeanLatencyMs } from './derive';

const percent = (value: number): string => formatPercent(value, 1);

/** Colored live figure with a Proof popover; null renders an em dash, never 0. */
function Figure({
  metric,
  tone,
  format,
  label,
  className,
}: {
  metric: MetricEnvelope<number> | undefined;
  tone: string;
  format?: (value: number) => string;
  label: string;
  className: string;
}) {
  const value = metric?.value ?? null;
  const text = metric && value !== null ? (format ? format(value) : formatCount(value)) : '—';
  return (
    <span className="inline-flex flex-wrap items-baseline justify-center gap-1.5">
      <span className={cn(className, value === null ? 'text-on-surface-variant' : tone)}>{text}</span>
      {metric && value === null ? <span className="text-caption text-on-surface-variant">{metric.reason ?? 'no data reported'}</span> : null}
      {metric ? <Proof source={metric.source} n={metric.n} asOf={metric.as_of} definition={metric.definition} reason={metric.reason} label={label} /> : null}
    </span>
  );
}

function RibbonTile({ label, dotClass, children, sub }: { label: string; dotClass: string; children: ReactNode; sub: string }) {
  return (
    <div className="flex flex-col items-center rounded border border-outline-variant/30 bg-surface-container-low/70 p-4">
      <span className="flex items-center gap-1 font-mono text-[10px] uppercase text-on-surface-variant">
        <span className={cn('h-1.5 w-1.5 rounded-full', dotClass)} aria-hidden="true" /> {label}
      </span>
      <div className="mt-0.5">{children}</div>
      <span className="mt-0.5 font-mono text-[10px] text-on-surface-variant">{sub}</span>
    </div>
  );
}

function PillarCard({
  icon,
  phase,
  accent,
  title,
  children,
  footer,
}: {
  icon: IconName;
  phase: string;
  accent: string;
  title: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-outline-variant/40 bg-surface-card/80 p-5 shadow-lg transition-transform hover:-translate-y-1">
      <div className="mb-3 flex items-center justify-between">
        <span className={cn('rounded border px-2 py-0.5 font-mono text-[10px] font-bold', accent)}>{phase}</span>
        <Icon name={icon} size={20} className="text-primary" />
      </div>
      <h3 className="mb-1 font-headline text-lg font-semibold text-on-surface">{title}</h3>
      <p className="mb-4 font-body text-xs leading-relaxed text-on-surface-variant">{children}</p>
      <div className="mt-auto space-y-1.5 border-t border-outline-variant/30 pt-3 font-mono text-[10px] text-on-surface-variant">{footer}</div>
    </div>
  );
}

function FooterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <span className="text-on-surface">{children}</span>
    </div>
  );
}

const CITATION_TONE: Record<CitationStatus, { label: string; cls: string }> = {
  VERIFIED: { label: 'Watchdog citation OK', cls: 'text-secondary' },
  DISCREPANCY: { label: 'Watchdog discrepancy', cls: 'text-tertiary' },
  INVALID_ROW: { label: 'Invalid cited row', cls: 'text-error' },
};

/** One real citation from the latest investigation, floating over the hero image. */
function CitationPin({ investigationId }: { investigationId: string }) {
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

export default function OverviewPage() {
  const evaluation = useAsync(getEvaluation, undefined, ['investigations']);
  // Accuracy counts model runs only; the offline stub's scored runs are reported next to it, never inside it.
  const stubScored = evaluation.data?.by_source?.stub.scored.value ?? 0;
  const stats = useAsync(getStats, 30_000, ['stats', 'investigations', 'actions']);
  const fleet = useAsync(getAgentFleet, 30_000, ['agents', 'credibility']);
  const scenarios = useAsync(listScenarios);
  const rawCounts = useAsync(getRawLogCounts, 30_000);
  const settings = useAsync(getSettings, 30_000, ['settings']);
  const status = useAsync(getSystemStatus, 30_000, ['investigations', 'agents', 'settings', 'actions']);
  const audit = useAsync(() => listAuditTrail({ limit: 200 }), 30_000, ['audit']);
  const recent = useAsync(() => listRecentRawLogs({ limit: 4 }), 30_000);
  const latest = useAsync(() => listInvestigations({ limit: 1 }), 30_000, ['investigations']);

  const latency = useMemo(() => deriveMeanLatencyMs(audit.data?.entries ?? []), [audit.data]);
  const providers = status.data?.providers;
  const latestItem = latest.data?.items?.[0];
  const latestConfidence = latestItem?.verdict_confidence ?? null;
  const recentRows = recent.data ?? [];

  return (
    <div className="relative flex w-full flex-col text-on-surface">
      {/* Ambient micro-grid background and radial glows */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-20 [background-size:28px_28px]"
        style={{ backgroundImage: 'radial-gradient(var(--color-primary) 1px, transparent 1px)' }}
      />
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/4 -z-10 h-[350px] w-[700px] max-w-full -translate-x-1/2 rounded-full bg-primary/10 blur-[140px]" />
      <div aria-hidden="true" className="pointer-events-none absolute right-10 top-3/4 -z-10 h-[420px] w-[420px] rounded-full bg-secondary/5 blur-[120px]" />

      {/* 1. HERO */}
      <section className="relative mx-auto w-full max-w-7xl px-4 pb-12 pt-8 lg:px-6">
        <div className="flex flex-col items-center space-y-4 text-center">
          {/* Specification badge */}
          <div className="inline-flex items-center gap-2 rounded border border-outline-variant/60 bg-surface-container-high/80 px-3 py-1 shadow-md backdrop-blur-md">
            <span className="h-2 w-2 rounded-full bg-primary animate-ping" aria-hidden="true" />
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-primary">Multi-agent debate · Watchdog verification</span>
            <span className="ml-1 rounded bg-secondary/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-secondary">Simulated response</span>
          </div>

          {/* Headline */}
          <h1 className="max-w-5xl font-headline text-4xl font-bold leading-tight tracking-tight text-on-surface sm:text-5xl lg:text-6xl">
            Multi-agent forensic adjudication for{' '}
            <span className="bg-linear-to-r from-primary via-primary-fixed to-secondary bg-clip-text text-transparent">insider and network threats</span>
          </h1>

          {/* Subtitle */}
          <p className="max-w-3xl font-body text-base leading-relaxed text-on-surface-variant sm:text-lg">
            Three investigator agents analyze different log slices and debate over three rounds. A Watchdog scores each agent's cited evidence against raw logs, and confirmed threats are contained in a sandbox.{' '}
            <strong className="font-semibold text-on-surface">Aggregation is deterministic code; the LLM output is not.</strong>
          </p>

          {/* Primary CTAs */}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <a
              href={buildRoute({ name: 'dashboard' })}
              className="flex items-center gap-2 rounded bg-primary-container px-6 py-3 font-mono text-xs font-bold tracking-wide text-on-primary shadow-glow-cyan transition-all hover:bg-primary active:scale-95"
            >
              <Icon name="dashboard" size={20} />
              <span>Open live console</span>
            </a>
            <a
              href={buildRoute({ name: 'trust' })}
              className="flex items-center gap-2 rounded border border-outline-variant/60 bg-surface-container-high px-6 py-3 font-mono text-xs font-semibold tracking-wide text-on-surface shadow-md transition-all hover:bg-surface-bright hover:text-primary"
            >
              <Icon name="verified_user" size={20} />
              <span>Watchdog credibility engine</span>
            </a>
            <a
              href={buildRoute({ name: 'investigations' })}
              className="flex items-center gap-1.5 rounded border border-outline-variant/40 bg-surface-container/70 px-5 py-3 font-mono text-xs text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
            >
              <Icon name="travel_explore" size={16} className="text-secondary" />
              <span>Browse investigations</span>
            </a>
          </div>

          {/* Telemetry HUD ribbon */}
          <div className="mt-6 grid w-full max-w-5xl grid-cols-2 gap-2 rounded-lg border border-outline-variant/40 bg-surface-container-lowest/80 p-1.5 shadow-xl backdrop-blur-md md:grid-cols-4">
            <RibbonTile
              label="Evaluated accuracy"
              dotClass="bg-secondary"
              sub={
                stubScored > 0
                  ? `model runs only · ${stubScored} offline-stub ${stubScored === 1 ? 'run' : 'runs'} not counted`
                  : 'ground-truth labelled only'
              }
            >
              <Figure metric={evaluation.data?.accuracy} tone="text-secondary" format={percent} label="Evaluated accuracy" className="font-headline text-2xl font-bold tracking-tight" />
            </RibbonTile>
            <RibbonTile label="Adjudication latency" dotClass="bg-primary" sub="audit start → verdict">
              <span className="inline-flex items-baseline justify-center gap-1.5">
                <span className={cn('font-headline text-2xl font-bold tracking-tight', latency.meanMs === null ? 'text-on-surface-variant' : 'text-primary')}>
                  {latency.meanMs === null ? '—' : formatDuration(latency.meanMs)}
                </span>
                <Proof
                  source="browser: GET /audit-trail timestamps"
                  n={latency.n}
                  asOf={audit.loadedAt}
                  definition="Mean of verdict_reached.created_at minus investigation_started.created_at, paired per investigation_id over the loaded audit entries."
                  label="Mean adjudication latency"
                />
              </span>
            </RibbonTile>
            <RibbonTile label="Grounding assurance" dotClass="bg-tertiary" sub="verified / total citations">
              <Figure metric={stats.data?.citations.verified_rate} tone="text-tertiary" format={percent} label="Verified-citation rate" className="font-headline text-2xl font-bold tracking-tight" />
            </RibbonTile>
            <RibbonTile label="Simulated actions" dotClass="bg-secondary" sub="share of response actions">
              <Figure metric={stats.data?.self_healing.simulated_share} tone="text-on-surface" format={percent} label="Simulated-action share" className="font-headline text-2xl font-bold tracking-tight" />
            </RibbonTile>
          </div>

          {/* Hero cyber terminal module */}
          <div className="relative mt-6 w-full max-w-6xl rounded-lg border border-outline-variant/50 bg-surface-container-lowest/90 p-2 shadow-hero">
            {/* Terminal header bar */}
            <div className="flex items-center justify-between rounded-t border-b border-outline-variant/40 bg-surface-container-high/90 px-4 py-2">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-error" aria-hidden="true" />
                  <span className="h-2.5 w-2.5 rounded-full bg-tertiary" aria-hidden="true" />
                  <span className="h-2.5 w-2.5 rounded-full bg-secondary" aria-hidden="true" />
                </div>
                <span className="pl-2 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">verdictchain forensic console</span>
              </div>
              <div className="flex items-center gap-4 font-mono text-[10px]">
                <span className="flex items-center gap-1 text-secondary">
                  <span className="h-1.5 w-1.5 rounded-full bg-secondary animate-pulse" aria-hidden="true" /> live telemetry
                </span>
                <span className="font-semibold text-primary">
                  {status.data ? `api ${status.data.api_version}` : 'api —'}
                </span>
              </div>
            </div>

            {/* Main terminal grid */}
            <div className="relative w-full overflow-hidden rounded-b bg-surface-container-low/95">
              <div className="grid grid-cols-1 gap-0 lg:grid-cols-12">
                {/* Left: raw ingestion ledger + dialectic gauge */}
                <div className="flex flex-col justify-between space-y-4 border-r border-outline-variant/40 bg-surface-container-lowest/80 p-4 text-left lg:col-span-4">
                  <div>
                    <div className="flex items-center justify-between border-b border-outline-variant/30 pb-2">
                      <span className="flex items-center gap-1 font-mono text-[10px] font-bold uppercase text-primary">
                        <Icon name="receipt_long" size={12} /> Raw ingestion ledger
                        <Proof
                          source="GET /raw-logs/recent"
                          n={recentRows.length}
                          asOf={recent.loadedAt}
                          definition="Most recent allow-listed raw_logs rows (row_id, timestamp, source, event_type, user_id, host_id, severity). No ground-truth label is ever returned."
                          label="Raw ingestion ledger"
                        />
                      </span>
                      <span className="font-mono text-[10px] text-on-surface-variant">CICIDS2017 · CERT</span>
                    </div>
                    <div className="mt-2 space-y-1.5 font-mono text-[11px] leading-relaxed text-on-surface-variant">
                      {recent.error && !recent.data ? (
                        <p className="text-on-surface-variant">Ledger unavailable: {recent.error}</p>
                      ) : recentRows.length === 0 ? (
                        <p className="text-on-surface-variant">No raw-log rows ingested yet.</p>
                      ) : (
                        recentRows.map((row) => {
                          const sev = (row.severity ?? '').toLowerCase();
                          const critical = sev === 'high' || sev === 'critical';
                          return (
                            <div
                              key={row.row_id}
                              className={cn(
                                'truncate rounded border p-1.5',
                                critical ? 'border-error/30 bg-error-container/40 text-on-error-container' : 'border-outline-variant/20 bg-surface-container/70 text-on-surface',
                              )}
                            >
                              <span className="text-tertiary">
                                [<Timestamp iso={row.timestamp} mode="clock" />]
                              </span>{' '}
                              <span className={cn('font-semibold', critical ? 'text-error' : 'text-secondary')}>{row.event_type ?? row.source}</span>
                              {row.user_id ? <span className="text-on-surface-variant"> user={row.user_id}</span> : null}
                              {row.host_id ? <span className="text-on-surface-variant"> host={row.host_id}</span> : null}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Dialectic consensus gauge (latest verdict confidence) */}
                  <div className="space-y-2 rounded border border-outline-variant/40 bg-surface-container-high/60 p-3">
                    <div className="flex items-center justify-between font-mono text-[11px]">
                      <span className="font-semibold uppercase text-on-surface">Agent-reported confidence</span>
                      <span className="inline-flex items-center gap-1 font-bold text-secondary">
                        {latestConfidence === null ? 'no verdict yet' : percent(latestConfidence)}
                        <Proof
                          source="GET /investigations?limit=1 verdict_confidence"
                          n={latest.data?.items?.length ?? 0}
                          asOf={latest.loadedAt}
                          definition="Latest investigation's aggregated agent-reported confidence (self-reported, not calibrated accuracy). Accuracy comes only from /evaluation."
                          label="Latest verdict confidence"
                        />
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest">
                      <div className="h-full bg-linear-to-r from-primary to-secondary" style={{ width: cssPercent(latestConfidence ?? 0) }} />
                    </div>
                    <div className="flex justify-between font-mono text-[9px] text-on-surface-variant">
                      <span>{latestItem ? `class: ${latestItem.verdict_class ?? 'pending'}` : 'no investigations'}</span>
                      <span>{latestItem ? `rounds: ${formatOutOf(latestItem.rounds_complete, settings.data?.debate_rounds)}` : '—'}</span>
                    </div>
                  </div>
                </div>

                {/* Right: holographic image with real citation pin */}
                <div className="relative flex min-h-[340px] items-center justify-center bg-background p-4 lg:col-span-8">
                  <img
                    src="/assets/holographic-soc.jpg"
                    alt="Abstract holographic forensic console artwork"
                    className="h-full max-h-[420px] w-full rounded border border-outline-variant/30 object-cover opacity-90 shadow-inner"
                  />
                  {latestItem ? <CitationPin key={latestItem.id} investigationId={latestItem.id} /> : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. FOUR-STAGE PIPELINE */}
      <section className="relative mx-auto w-full max-w-7xl px-4 py-12 lg:px-6">
        <div className="mx-auto mb-10 max-w-3xl space-y-2 text-center">
          <span className="font-mono text-xs font-bold uppercase tracking-widest text-primary">Pipeline</span>
          <h2 className="font-headline text-3xl font-bold text-on-surface sm:text-4xl">Four stages of adjudication</h2>
          <p className="font-body text-sm text-on-surface-variant sm:text-base">
            From raw telemetry to a Watchdog-verified, hash-chained verdict with a sandboxed, fully audited response.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
          <PillarCard
            icon="receipt_long"
            phase="PHASE 01"
            accent="border-primary/20 bg-primary/10 text-primary"
            title="Multi-source ingestion"
            footer={
              (rawCounts.data?.sources ?? []).length === 0 ? (
                <FooterRow label="Rows">—</FooterRow>
              ) : (
                (rawCounts.data?.sources ?? []).map((row) => (
                  <FooterRow key={row.source} label={row.source}>
                    <Metric metric={row.count} size="body" label={`${row.source} rows`} />
                  </FooterRow>
                ))
              )
            }
          >
            Raw telemetry from the datasets is stored as rows in raw_logs in PostgreSQL. Counts are the real ingested totals per source.
          </PillarCard>

          <PillarCard
            icon="hub"
            phase="PHASE 02"
            accent="border-tertiary/20 bg-tertiary/10 text-tertiary"
            title="Three-round debate"
            footer={
              <>
                <FooterRow label="Rounds">{settings.data ? formatCount(settings.data.debate_rounds) : '—'}</FooterRow>
                <div className="flex flex-wrap gap-1.5">
                  {(fleet.data ?? []).map((agent) => (
                    <AgentChip key={agent.agent_id} agentId={agent.agent_id} name={agent.display_name} />
                  ))}
                </div>
              </>
            }
          >
            Three investigator agents cross-examine each other's hypotheses over a fixed number of rounds. Agent names come from the live fleet.
          </PillarCard>

          <PillarCard
            icon="verified_user"
            phase="PHASE 03"
            accent="border-secondary/20 bg-secondary/10 text-secondary"
            title="Watchdog verification"
            footer={
              <>
                <FooterRow label="Invalid citations">
                  <Metric metric={stats.data?.citations.invalid_row} size="body" label="Invalid citations" />
                </FooterRow>
                <FooterRow label="Discrepancies">
                  <Metric metric={stats.data?.watchdog.discrepancies} size="body" label="Discrepancies" />
                </FooterRow>
              </>
            }
          >
            Every cited log line is re-checked against raw_logs in PostgreSQL. Fabricated or mismatched citations lower the agent's credibility.
          </PillarCard>

          <PillarCard
            icon="warning"
            phase="PHASE 04"
            accent="border-primary/20 bg-primary/10 text-primary"
            title="Sandboxed response"
            footer={
              <>
                <FooterRow label="Simulated share">
                  <Metric metric={stats.data?.self_healing.simulated_share} size="body" format={percent} label="Simulated share" />
                </FooterRow>
                <FooterRow label="Sandbox violations">
                  <Metric metric={status.data?.sandbox.is_simulated_violations} size="body" label="Sandbox violations" />
                </FooterRow>
              </>
            }
          >
            Containment runs in a sandbox only and is fully audited; restore is audited too. Actions never reach a real system.
          </PillarCard>
        </div>
      </section>

      {/* 3. BENCHMARK SCENARIO SUITE */}
      <section className="relative mx-auto w-full max-w-7xl px-4 py-10 lg:px-6">
        <div className="rounded-xl border border-outline-variant/50 bg-background p-5 shadow-2xl">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-mono text-[10px] uppercase text-on-surface-variant">Benchmark topology</span>
              <h3 className="font-headline text-lg font-semibold text-on-surface">Scenario suite</h3>
            </div>
            <span className="rounded border border-primary/30 bg-primary/20 px-2 py-0.5 font-mono text-[10px] font-bold text-primary">LIVE INGESTION</span>
          </div>

          <div className="relative mt-4 w-full overflow-hidden rounded border border-outline-variant/40">
            <img src="/assets/topology-grid.jpg" alt="Abstract network topology grid artwork" className="h-56 w-full rounded object-cover opacity-80" />
            <div className="absolute inset-0 bg-linear-to-t from-background via-transparent to-transparent" />
            <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between font-mono text-[10px] text-on-surface">
              <span className="rounded border border-outline-variant/40 bg-surface/90 px-2 py-1 text-secondary backdrop-blur-sm">
                {scenarios.data ? formatCountNoun(scenarios.data.length, 'scenario label') : 'scenarios loading'}
              </span>
              <span className="rounded border border-outline-variant/40 bg-surface/90 px-2 py-1 text-primary backdrop-blur-sm">
                Agents never see the label (blind test)
              </span>
            </div>
          </div>

          <p className="mt-4 font-body text-sm text-on-surface-variant">
            The real scenario labels, their dataset and ingested row count. Investigator agents are never told which scenario was selected.
          </p>

          {scenarios.error && !scenarios.data ? (
            <div className="mt-4">
              <EmptyState title="Could not load scenarios" description={scenarios.error} icon="warning" />
            </div>
          ) : (scenarios.data ?? []).length === 0 ? (
            <div className="mt-4">
              <EmptyState title="No scenarios reported" icon="info" />
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {(scenarios.data ?? []).map((scenario) => (
                <div key={scenario.label} className="flex flex-col gap-2 rounded-xl border border-outline-variant/40 bg-surface-card p-4 transition-colors hover:border-primary/50">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-primary">{scenario.label}</span>
                    <span className="rounded-full border border-outline-variant/40 bg-surface-container-high px-2 py-0.5 font-mono text-[10px] uppercase text-on-surface-variant">{scenario.dataset}</span>
                  </div>
                  <p className="font-body text-xs text-on-surface-variant">{scenario.description}</p>
                  <div className="mt-auto flex items-center justify-between border-t border-outline-variant/40 pt-2">
                    {scenario.primary_agent ? (
                      <AgentChip agentId={scenario.primary_agent} name={scenario.primary_agent} />
                    ) : (
                      <span className="font-mono text-[10px] text-on-surface-variant">no rows ingested for this label</span>
                    )}
                    <Metric metric={scenario.row_count} size="body" label={`${scenario.label} rows`} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 4. TRUST & CREDIBILITY */}
      <section className="relative mx-auto w-full max-w-7xl px-4 py-12 lg:px-6">
        <div className="mx-auto mb-10 max-w-3xl space-y-2 text-center">
          <span className="font-mono text-xs font-bold uppercase tracking-widest text-secondary">Foundation</span>
          <h2 className="font-headline text-3xl font-bold text-on-surface sm:text-4xl">Trust &amp; credibility architecture</h2>
          <p className="font-body text-sm text-on-surface-variant sm:text-base">Deterministic aggregation, raw-log verification and a tamper-evident, hash-chained audit trail.</p>
        </div>

        <div className="grid grid-cols-1 gap-5 text-left md:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col justify-between rounded-xl border border-outline-variant/40 bg-surface-card p-5 shadow-lg">
            <div className="space-y-2">
              <Icon name="receipt_long" size={20} className="text-primary" />
              <h3 className="font-headline text-base font-semibold text-on-surface">Tamper-evident audit</h3>
              <p className="font-body text-xs leading-relaxed text-on-surface-variant">Every action is hash-chained with SHA-256 in PostgreSQL. Each entry's hash can be recomputed in the browser.</p>
            </div>
            <div className="mt-4 rounded border border-outline-variant/30 bg-background p-2 font-mono text-xs">
              <div className="font-semibold text-primary">Chain: {audit.data ? (audit.data.chain.valid ? 'valid' : 'broken') : '—'}</div>
              <div className="mt-0.5 text-[9px] text-on-surface-variant">{audit.data ? `${formatCount(audit.data.chain.total)} entries` : '— entries'}</div>
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-outline-variant/40 bg-surface-card p-5 shadow-lg">
            <div className="space-y-2">
              <Icon name="verified_user" size={20} className="text-secondary" />
              <h3 className="font-headline text-base font-semibold text-on-surface">Credibility scoring</h3>
              <p className="font-body text-xs leading-relaxed text-on-surface-variant">Each agent's credibility moves with its verified-citation rate, scaled by the learning rate η from settings.</p>
            </div>
            <div className="mt-4 rounded border border-outline-variant/30 bg-background p-2 font-mono text-xs">
              <div className="font-semibold text-secondary">η (eta): {settings.data ? formatNumber(settings.data.eta, 2) : '—'}</div>
              <div className="mt-0.5 flex items-center gap-1 text-[9px] text-on-surface-variant">
                Brier (feedback): <Metric metric={stats.data?.brier} size="body" label="Brier score" />
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-outline-variant/40 bg-surface-card p-5 shadow-lg">
            <div className="space-y-2">
              <Icon name="warning" size={20} className="text-tertiary" />
              <h3 className="font-headline text-base font-semibold text-on-surface">Sandboxed response</h3>
              <p className="font-body text-xs leading-relaxed text-on-surface-variant">Self-healing actions run in a sandbox with no networking imports. The simulation flag is recorded on every action.</p>
            </div>
            <div className="mt-4 flex items-center gap-1 rounded border border-outline-variant/30 bg-background p-2 font-mono text-xs text-on-surface-variant">
              Sandbox violations: <Metric metric={status.data?.sandbox.is_simulated_violations} size="body" label="Sandbox violations" />
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-outline-variant/40 bg-surface-card p-5 shadow-lg">
            <div className="space-y-2">
              <Icon name="hub" size={20} className="text-primary-fixed" />
              <h3 className="font-headline text-base font-semibold text-on-surface">Configured providers</h3>
              <p className="font-body text-xs leading-relaxed text-on-surface-variant">The LLM backends the agents actually call, read from the live system status. No keys are ever exposed.</p>
            </div>
            <div className="mt-4 rounded border border-outline-variant/30 bg-background p-2 font-mono text-xs">
              <div className="text-on-surface">Groq: {providers?.groq.configured ? (providers.groq.model ?? 'configured') : 'not configured'}</div>
              <div className="mt-0.5 text-on-surface">Gemini: {providers?.gemini.configured ? (providers.gemini.model ?? 'configured') : 'not configured'}</div>
            </div>
          </div>
        </div>
      </section>

      {/* 5. FINAL CTA */}
      <section className="relative mx-auto w-full max-w-7xl px-4 pb-16 pt-6 lg:px-6">
        <div className="relative overflow-hidden rounded-2xl border border-primary-container/40 bg-surface-card p-8 text-center shadow-2xl lg:p-12">
          <div className="pointer-events-none absolute inset-0 bg-linear-to-r from-primary/10 via-transparent to-secondary/10" />
          <div className="relative z-10 mx-auto max-w-3xl space-y-4">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant/40 bg-background px-3 py-1 font-mono text-[11px] text-primary">
              <span className="h-2 w-2 rounded-full bg-secondary" aria-hidden="true" />
              EVERY VALUE BACKED BY THE API
            </div>
            <h2 className="font-headline text-3xl font-bold tracking-tight text-on-surface sm:text-4xl">Ready to review multi-agent forensic consensus?</h2>
            <p className="font-body text-sm leading-relaxed text-on-surface-variant sm:text-base">
              Open the live console to inject a scenario and watch the debate, verification and sandboxed response unfold, with every value backed by the API.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
              <a
                href={buildRoute({ name: 'dashboard' })}
                className="flex items-center gap-2 rounded bg-primary-container px-6 py-3.5 font-mono text-xs font-bold tracking-wide text-on-primary shadow-glow-cyan transition-all hover:bg-primary"
              >
                <Icon name="dashboard" size={20} />
                <span>Open live console</span>
              </a>
              <a
                href={buildRoute({ name: 'investigations' })}
                className="flex items-center gap-2 rounded border border-outline-variant/60 bg-surface-container-high px-6 py-3.5 font-mono text-xs font-semibold tracking-wide text-on-surface transition-colors hover:bg-surface-bright"
              >
                <Icon name="travel_explore" size={20} />
                <span>Browse investigations</span>
              </a>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-6 pt-4 font-mono text-[10px] text-on-surface-variant">
              <span className="flex items-center gap-1.5">
                <Icon name="verified_user" size={16} className="text-secondary" /> Tamper-evident audit
              </span>
              <span className="flex items-center gap-1.5">
                <Icon name="check" size={16} className="text-primary" /> Watchdog-verified citations
              </span>
              <span className="flex items-center gap-1.5">
                <Icon name="warning" size={16} className="text-tertiary" /> Sandboxed response
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
