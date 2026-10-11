/** The hero of the Overview screen: headline, calls to action, the four live ribbon figures and the console preview. */
import { buildRoute } from '../../app/router';
import { cn } from '../../lib/cn';
import { cssPercent, formatDuration, formatOutOf } from '../../lib/format';
import { Icon } from '../../ui/Icon';
import { Proof } from '../../ui/Proof';
import { Timestamp } from '../../ui/Timestamp';
import { Figure, RibbonTile, percent } from './parts';
import { CitationPin } from './CitationPin';
import type { useOverviewData } from './useOverviewData';

type Props = Pick<ReturnType<typeof useOverviewData>, 'stubScored' | 'evaluation' | 'latency' | 'audit' | 'stats' | 'status' | 'recentRows' | 'recent' | 'latestConfidence' | 'latest' | 'latestItem' | 'settings'>;

export function Hero({ stubScored, evaluation, latency, audit, stats, status, recentRows, recent, latestConfidence, latest, latestItem, settings }: Props) {
  return (
    <>
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
            Three investigator agents analyze different log slices and debate over three rounds. A Watchdog scores each agent's cited evidence against raw logs, and a confident verdict backed by credible agents is contained in a sandbox.{' '}
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
                  definition="Mean of verdict_reached.created_at minus investigation_started.created_at, paired per investigation_id over the loaded audit entries. investigation_started is written when a case is accepted, so a case that waited in the debate queue includes its wait."
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
    </>
  );
}
