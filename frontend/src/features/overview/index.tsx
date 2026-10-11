import { buildRoute } from '../../app/router';
import { formatCount, formatNumber } from '../../lib/format';
import { Icon } from '../../ui/Icon';
import { Metric } from '../../ui/Metric';
import { useOverviewData } from './useOverviewData';
import { ScenarioSuite } from './ScenarioSuite';
import { Pipeline } from './Pipeline';
import { Hero } from './Hero';

export default function OverviewPage() {
  const { stubScored, evaluation, latency, audit, stats, status, recentRows, recent, latestConfidence, latest, latestItem, settings, rawCounts, fleet, scenarios, providers } = useOverviewData();

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

      <Hero stubScored={stubScored} evaluation={evaluation} latency={latency} audit={audit} stats={stats} status={status} recentRows={recentRows} recent={recent} latestConfidence={latestConfidence} latest={latest} latestItem={latestItem} settings={settings} />

      <Pipeline rawCounts={rawCounts} settings={settings} fleet={fleet} stats={stats} status={status} />

      <ScenarioSuite scenarios={scenarios} />

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
              <h3 className="font-headline text-base font-semibold text-on-surface">Configured provider</h3>
              <p className="font-body text-xs leading-relaxed text-on-surface-variant">The LLM the agents actually call, read from the live system status. No key is ever exposed.</p>
            </div>
            <div className="mt-4 rounded border border-outline-variant/30 bg-background p-2 font-mono text-xs">
              <div className="text-on-surface">OpenAI: {providers?.openai.configured ? (providers.openai.model ?? 'configured') : 'not configured'}</div>
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
