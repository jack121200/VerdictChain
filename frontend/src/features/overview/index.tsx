import { useMemo, type ReactNode } from 'react';
import { getAgentFleet, getEvaluation, getRawLogCounts, getSettings, getStats, getSystemStatus, listAuditTrail, listScenarios } from '../../api/client';
import { useAsync } from '../../app/use-async';
import { buildRoute } from '../../app/router';
import { formatCount, formatDuration, formatNumber, formatPercent } from '../../lib/format';
import { AgentChip } from '../../ui/AgentChip';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icon-names';
import { Metric } from '../../ui/Metric';
import { Pill } from '../../ui/Pill';
import { Proof } from '../../ui/Proof';
import { StatusDot } from '../../ui/StatusDot';
import type { StatusTone } from '../../ui/StatusDot';
import { deriveMeanLatencyMs } from './derive';

const percent = (value: number): string => formatPercent(value, 1);

function RibbonTile({ label, dotTone, children, sub }: { label: string; dotTone: StatusTone; children: ReactNode; sub: string }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-outline-variant/40 bg-surface-card p-4 text-center">
      <span className="inline-flex items-center gap-1.5 text-label uppercase text-on-surface-variant">
        <StatusDot tone={dotTone} /> {label}
      </span>
      <div className="mt-1 flex items-center justify-center gap-2">{children}</div>
      <span className="mt-0.5 text-caption text-on-surface-variant">{sub}</span>
    </div>
  );
}

function Pillar({ icon, phase, title, children, footer }: { icon: IconName; phase: string; title: string; children: ReactNode; footer: ReactNode }) {
  return (
    <Card className="flex flex-col">
      <div className="mb-3 flex items-center justify-between">
        <Pill tone="primary">{phase}</Pill>
        <Icon name={icon} size={20} className="text-primary" />
      </div>
      <h3 className="mb-1 font-headline text-h3 text-on-surface">{title}</h3>
      <div className="mb-4 text-caption leading-relaxed text-on-surface-variant">{children}</div>
      <div className="mt-auto space-y-1.5 border-t border-outline-variant/40 pt-3">{footer}</div>
    </Card>
  );
}

function FooterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-label uppercase text-on-surface-variant">
      <span>{label}</span>
      <span className="font-mono normal-case text-on-surface">{children}</span>
    </div>
  );
}

export default function OverviewPage() {
  const evaluation = useAsync(getEvaluation);
  const stats = useAsync(getStats, 30_000);
  const fleet = useAsync(getAgentFleet, 30_000);
  const scenarios = useAsync(listScenarios);
  const rawCounts = useAsync(getRawLogCounts, 30_000);
  const settings = useAsync(getSettings, 30_000);
  const status = useAsync(getSystemStatus, 30_000);
  const audit = useAsync(() => listAuditTrail({ limit: 200 }), 30_000);

  const latency = useMemo(() => deriveMeanLatencyMs(audit.data?.entries ?? []), [audit.data]);
  const providers = status.data?.providers;

  return (
    <div className="relative mx-auto w-full max-w-7xl px-4 py-8 lg:px-6">
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-24 -z-10 h-72 w-[42rem] max-w-full -translate-x-1/2 rounded-full bg-primary/5 blur-3xl" />

      {/* 1. Hero */}
      <section className="flex flex-col items-center gap-4 text-center">
        <Pill tone="primary" icon="verified_user">
          Multi-agent debate · Watchdog verification · Simulated response
        </Pill>
        <h1 className="max-w-4xl font-headline text-h1 font-bold leading-tight tracking-tight text-on-surface sm:text-h1-sm">
          Multi-agent forensic adjudication for{' '}
          <span className="text-transparent bg-clip-text bg-linear-to-r from-primary via-primary-fixed to-secondary">insider and network threats</span>
        </h1>
        <p className="max-w-3xl text-body-lg leading-relaxed text-on-surface-variant">
          Three investigator agents analyze different log slices and debate over three rounds. A Watchdog scores each agent's cited evidence against raw logs, and confirmed threats are contained in a sandbox. Aggregation is deterministic code; the LLM output is not.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
          <a href={buildRoute({ name: 'dashboard' })}>
            <Button variant="primary" icon="dashboard">
              Open live console
            </Button>
          </a>
          <a href={buildRoute({ name: 'trust' })}>
            <Button variant="secondary" icon="verified_user">
              Watchdog credibility engine
            </Button>
          </a>
          <a href={buildRoute({ name: 'investigations' })}>
            <Button variant="ghost" icon="travel_explore">
              Browse investigations
            </Button>
          </a>
        </div>

        {/* Telemetry ribbon */}
        <div className="mt-6 grid w-full max-w-5xl grid-cols-2 gap-2 rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-1.5 md:grid-cols-4">
          <RibbonTile label="Evaluated accuracy" dotTone="ok" sub="ground-truth labelled only">
            <Metric metric={evaluation.data?.accuracy} format={percent} label="Evaluated accuracy" />
          </RibbonTile>
          <RibbonTile label="Mean adjudication latency" dotTone="live" sub="audit start → verdict">
            <span className="font-headline text-kpi tabular-nums text-on-surface">{latency.meanMs === null ? '—' : formatDuration(latency.meanMs)}</span>
            {latency.meanMs === null ? <span className="text-caption text-on-surface-variant">no completed adjudications yet</span> : null}
            <Proof
              source="browser: GET /audit-trail timestamps"
              n={latency.n}
              asOf={audit.loadedAt}
              definition="Mean of verdict_reached.created_at minus investigation_started.created_at, paired per investigation_id over the loaded audit entries."
              label="Mean adjudication latency"
            />
          </RibbonTile>
          <RibbonTile label="Grounding (verified citations)" dotTone="warn" sub="verified / total">
            <Metric metric={stats.data?.citations.verified_rate} format={percent} label="Verified-citation rate" />
          </RibbonTile>
          <RibbonTile label="Simulated actions" dotTone="ok" sub="share of response actions">
            <Metric metric={stats.data?.self_healing.simulated_share} format={percent} label="Simulated-action share" />
          </RibbonTile>
        </div>

        {/* Hero image (decor, no numbers) */}
        <figure className="mt-6 w-full max-w-6xl overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-lowest shadow-hero">
          <img src="/assets/holographic-soc.jpg" alt="Abstract holographic console artwork" className="h-auto w-full object-cover opacity-90" />
        </figure>
      </section>

      {/* 2. Pillars */}
      <section className="py-12">
        <div className="mx-auto mb-8 max-w-3xl space-y-2 text-center">
          <span className="text-label uppercase tracking-widest text-primary">Pipeline</span>
          <h2 className="font-headline text-h1 font-bold text-on-surface">Four stages of adjudication</h2>
        </div>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
          <Pillar
            icon="receipt_long"
            phase="Stage 01"
            title="Multi-source ingestion"
            footer={
              (rawCounts.data ?? []).length === 0 ? (
                <FooterRow label="Rows">—</FooterRow>
              ) : (
                (rawCounts.data ?? []).map((row) => (
                  <FooterRow key={row.source} label={row.source}>
                    <Metric metric={row.count} size="body" label={`${row.source} rows`} />
                  </FooterRow>
                ))
              )
            }
          >
            Raw telemetry from the datasets is stored as rows in raw_logs in PostgreSQL. Counts are the real ingested totals per source.
          </Pillar>

          <Pillar
            icon="hub"
            phase="Stage 02"
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
          </Pillar>

          <Pillar
            icon="verified_user"
            phase="Stage 03"
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
          </Pillar>

          <Pillar
            icon="warning"
            phase="Stage 04"
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
          </Pillar>
        </div>
      </section>

      {/* 3. Scenario suite */}
      <section className="py-6">
        <div className="mx-auto mb-8 max-w-3xl space-y-2 text-center">
          <span className="text-label uppercase tracking-widest text-secondary">Benchmark</span>
          <h2 className="font-headline text-h1 font-bold text-on-surface">Scenario suite</h2>
          <p className="text-body text-on-surface-variant">The real scenario labels, their dataset and ingested row count. Investigator agents are never told which scenario was selected.</p>
        </div>
        {scenarios.error && !scenarios.data ? (
          <EmptyState title="Could not load scenarios" description={scenarios.error} icon="warning" />
        ) : (scenarios.data ?? []).length === 0 ? (
          <EmptyState title="No scenarios reported" icon="info" />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(scenarios.data ?? []).map((scenario) => (
              <Card key={scenario.label} hoverTone="primary" className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-evidence font-bold text-primary">{scenario.label}</span>
                  <Pill tone="neutral">{scenario.dataset}</Pill>
                </div>
                <p className="text-caption text-on-surface-variant">{scenario.description}</p>
                <div className="mt-auto flex items-center justify-between border-t border-outline-variant/40 pt-2">
                  <AgentChip agentId={scenario.primary_agent} name={scenario.primary_agent} />
                  <Metric metric={scenario.row_count} size="body" label={`${scenario.label} rows`} />
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* 4. Trust architecture */}
      <section className="py-12">
        <div className="mx-auto mb-8 max-w-3xl space-y-2 text-center">
          <span className="text-label uppercase tracking-widest text-secondary">Foundation</span>
          <h2 className="font-headline text-h1 font-bold text-on-surface">Trust &amp; credibility</h2>
        </div>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
          <Card className="flex flex-col gap-2">
            <Icon name="receipt_long" size={20} className="text-primary" />
            <h3 className="font-headline text-h3 text-on-surface">Tamper-evident audit</h3>
            <p className="text-caption leading-relaxed text-on-surface-variant">Every action is hash-chained with SHA-256 in PostgreSQL. Each entry's hash can be recomputed in the browser.</p>
            <div className="mt-auto rounded-lg border border-outline-variant/40 bg-background p-2.5">
              <FooterRow label="Chain">{audit.data ? (audit.data.chain.valid ? 'valid' : 'broken') : '—'}</FooterRow>
              <FooterRow label="Entries">{audit.data ? formatCount(audit.data.chain.total) : '—'}</FooterRow>
            </div>
          </Card>

          <Card className="flex flex-col gap-2">
            <Icon name="verified_user" size={20} className="text-secondary" />
            <h3 className="font-headline text-h3 text-on-surface">Credibility scoring</h3>
            <p className="text-caption leading-relaxed text-on-surface-variant">Each agent's credibility moves with its verified-citation rate, scaled by the learning rate η from settings.</p>
            <div className="mt-auto rounded-lg border border-outline-variant/40 bg-background p-2.5">
              <FooterRow label="η (eta)">{settings.data ? formatNumber(settings.data.eta, 2) : '—'}</FooterRow>
              <FooterRow label="Brier (feedback)">
                <Metric metric={stats.data?.brier} size="body" label="Brier score" />
              </FooterRow>
            </div>
          </Card>

          <Card className="flex flex-col gap-2">
            <Icon name="warning" size={20} className="text-error" />
            <h3 className="font-headline text-h3 text-on-surface">Sandboxed response</h3>
            <p className="text-caption leading-relaxed text-on-surface-variant">Self-healing actions run in a sandbox with no networking imports. The simulation flag is recorded on every action.</p>
            <div className="mt-auto rounded-lg border border-outline-variant/40 bg-background p-2.5">
              <FooterRow label="Sandbox violations">
                <Metric metric={status.data?.sandbox.is_simulated_violations} size="body" label="Sandbox violations" />
              </FooterRow>
            </div>
          </Card>

          <Card className="flex flex-col gap-2">
            <Icon name="hub" size={20} className="text-primary" />
            <h3 className="font-headline text-h3 text-on-surface">Configured providers</h3>
            <p className="text-caption leading-relaxed text-on-surface-variant">The LLM backends the agents actually call, read from the live system status. No keys are ever exposed.</p>
            <div className="mt-auto rounded-lg border border-outline-variant/40 bg-background p-2.5">
              <FooterRow label="Groq">{providers?.groq.configured ? (providers.groq.model ?? 'configured') : 'not configured'}</FooterRow>
              <FooterRow label="Gemini">{providers?.gemini.configured ? (providers.gemini.model ?? 'configured') : 'not configured'}</FooterRow>
            </div>
          </Card>
        </div>
      </section>

      {/* 5. Final CTA */}
      <section className="pb-16 pt-2">
        <Card hairline className="flex flex-col items-center gap-4 p-8 text-center shadow-xl lg:p-12">
          <h2 className="max-w-3xl font-headline text-h1 font-bold tracking-tight text-on-surface">Ready to review multi-agent forensic consensus?</h2>
          <p className="max-w-2xl text-body text-on-surface-variant">Open the live console to inject a scenario and watch the debate, verification and sandboxed response unfold with every value backed by the API.</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <a href={buildRoute({ name: 'dashboard' })}>
              <Button variant="primary" icon="dashboard">
                Open live console
              </Button>
            </a>
            <a href={buildRoute({ name: 'investigations' })}>
              <Button variant="secondary" icon="travel_explore">
                Browse investigations
              </Button>
            </a>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-6 pt-2 text-label uppercase text-on-surface-variant">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="verified_user" size={16} className="text-secondary" /> Tamper-evident audit
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Icon name="check" size={16} className="text-primary" /> Watchdog-verified citations
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Icon name="warning" size={16} className="text-tertiary" /> Sandboxed response
            </span>
          </div>
        </Card>
      </section>
    </div>
  );
}
