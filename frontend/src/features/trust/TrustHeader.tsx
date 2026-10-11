/** The Trust screen header: the reliability headline and its status tiles. */
import { type ReactNode } from 'react';
import type { Metric as MetricEnvelope } from '../../api/types';
import { cn } from '../../lib/cn';
import { formatCount, formatPercent, formatSignedPercent } from '../../lib/format';
import { Icon } from '../../ui/Icon';
import { Metric } from '../../ui/Metric';
import { Proof } from '../../ui/Proof';

// ---- Section 1: header ---------------------------------------------------------

export function StatusTile({
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

export function TrustHeader({
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
                  {overall.value === null ? 'no cycle yet' : `${formatSignedPercent(overall.value)} this cycle`}
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
              {fleetLoaded ? formatCount(isolated) : '—'}
            </span>
            <span className="text-sm font-bold text-secondary">/{fleetLoaded ? formatCount(fleetCount) : '—'}</span>
            <Proof
              source="GET /agents/fleet.isolated"
              n={fleetCount}
              asOf={null}
              definition="Count of investigators currently quarantined (isolated = true) out of the three investigators."
              label="Quarantined agents"
            />
          </StatusTile>

          <StatusTile tone="tertiary" label="Flagged warnings" sub={<span>recent discrepancy</span>}>
            <span className="font-headline text-3xl font-bold tracking-tighter text-tertiary">{formatCount(flaggedCount)}</span>
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
