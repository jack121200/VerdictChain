/** The incident banner and its counters. */
import type { ReactNode } from 'react';
import type { AuditChain, InvestigationSummary, Metric as MetricEnvelope, StatsResponse } from '../../api/types';
import { cn } from '../../lib/cn';
import { formatCount, shortId } from '../../lib/format';
import { type Tone } from '../../ui/classes';
import { CopyButton } from '../../ui/CopyHash';
import { Icon } from '../../ui/Icon';
import { Proof } from '../../ui/Proof';
import { Skeleton } from '../../ui/Skeleton';
import { verdictIcon } from '../investigations/labels';
import { PERCENT1, Stat, TONE_BAR, TONE_HOVER, TONE_TEXT, verdictPillClass } from './shared';

// ---- 1. Tactical status banner + telemetry cards ----------------------------------

export interface TacticalBannerProps {
  threat: InvestigationSummary | null;
  loading: boolean;
  subject: string | null;
  host: string | null;
  primaryAgentName: string | null;
  chain: AuditChain | undefined;
  chainLoadedAt: string | null;
  stats: StatsResponse | undefined;
}

export function TacticalBanner({
  threat,
  loading,
  subject,
  host,
  primaryAgentName,
  chain,
  chainLoadedAt,
  stats,
}: TacticalBannerProps) {
  return (
    <section className="relative flex flex-col gap-4 rounded-xl border border-outline-variant/40 bg-surface-container-low p-4 shadow-xl">
      {/* Incident strip */}
      <div className="flex flex-col justify-between gap-3 rounded-lg border border-outline-variant/30 bg-background p-3 lg:flex-row lg:items-center">
        {threat === null ? (
          loading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <span className="font-body text-[13px] text-on-surface-variant">
              No threat verdict yet — the incident banner tracks the most recent investigation with a threat-class verdict.
            </span>
          )
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded border border-error/40 bg-error-container/30 px-2 py-0.5 font-mono text-xs font-semibold uppercase text-error">
              <span className="relative inline-flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-1.5 w-1.5 animate-ping rounded-full bg-error opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-error" />
              </span>
              Latest threat verdict
            </span>
            <span className="font-headline text-base font-semibold tracking-tight text-on-surface sm:text-lg">
              {threat.dataset ?? 'Investigation'} ·{' '}
              <strong className="font-mono text-primary">{shortId(threat.id)}</strong>{' '}
              <CopyButton value={threat.id} label="incident investigation id" />
            </span>
            <span className="hidden text-outline-variant sm:inline">•</span>
            <span className="inline-flex items-center gap-1">
              <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase', verdictPillClass(threat.verdict_class))}>
                <Icon name={verdictIcon(threat.verdict_class)} size={12} />
                {threat.verdict_class ?? 'no class'}
              </span>
            </span>
            <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-on-surface-variant">
              <span>SUBJECT</span>
              <span className="rounded border border-outline-variant/30 bg-surface-card px-1.5 py-0.5 font-semibold text-tertiary">
                {subject ?? '—'}
              </span>
              <span>HOST</span>
              <span className="rounded border border-outline-variant/30 bg-surface-card px-1.5 py-0.5 font-semibold text-primary">
                {host ?? '—'}
              </span>
              {primaryAgentName && threat.primary_agent && (
                <span className="text-outline">· domain {primaryAgentName}</span>
              )}
              <Proof
                source="GET /investigations/{id}/citations"
                n={1}
                asOf={null}
                label="Incident subject and host"
                definition="The most-cited user_id and host_id across this investigation's VERIFIED citations (values an agent only claimed are ignored). A tie is broken by the lexicographically smallest value. '—' when no verified citation names that field. No identifiers are typed in."
              />
            </div>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-3 font-mono text-xs">
          {chain ? (
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded border px-2.5 py-1',
                chain.valid ? 'border-secondary/30 bg-surface-card text-secondary' : 'border-error/40 bg-surface-card text-error',
              )}
            >
              <Icon name={chain.valid ? 'verified_user' : 'warning'} size={12} />
              <span>Log integrity: {chain.valid ? 'chain valid' : 'chain broken'}</span>
              <Proof
                source="GET /audit-trail (chain.valid)"
                n={chain.total}
                asOf={chainLoadedAt}
                label="Log integrity"
                definition="chain.valid over the SHA-256 hash-chained audit entries. n is the total number of entries."
              />
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded border border-outline-variant/40 bg-surface-card px-2.5 py-1 text-on-surface-variant">
              Log integrity: not verified
            </span>
          )}
        </div>
      </div>

      {/* Telemetry cards */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <TelemetryCard
          label="Investigating now"
          icon="hub"
          tone="primary"
          metric={stats?.active}
          sub={<span className="text-on-surface-variant">Debates running now</span>}
        />
        <TelemetryCard
          label="Insider verdicts"
          icon="warning"
          tone="tertiary"
          metric={stats?.insider_count}
          sub={
            <span className="inline-flex items-center gap-1 text-on-surface-variant">
              all verdicts · agent-reported conf.
              <Stat
                metric={stats?.mean_agent_confidence}
                className="font-semibold text-tertiary"
                format={PERCENT1}
                label="Mean agent-reported confidence (all verdicts)"
              />
            </span>
          }
        />
        <TelemetryCard
          label="Fleet credibility"
          icon="verified_user"
          tone="secondary"
          metric={stats?.mean_crs}
          format={PERCENT1}
          sub={<span className="text-on-surface-variant">Mean credibility score (CrS) · n = {stats ? formatCount(stats.mean_crs.n) : '—'}</span>}
        />
        <TelemetryCard
          label="Containment actions"
          icon="admin_panel_settings"
          tone="primary"
          metric={stats?.self_healing?.actions_total}
          sub={
            <span className="inline-flex items-center gap-1 text-on-surface-variant">
              non-simulated
              <Stat metric={stats?.self_healing?.non_simulated} className="font-semibold text-secondary" label="Non-simulated containment actions" />
            </span>
          }
        />
      </div>
    </section>
  );
}

export function TelemetryCard({
  label,
  icon,
  tone,
  metric,
  format = formatCount,
  sub,
}: {
  label: string;
  icon: 'hub' | 'warning' | 'verified_user' | 'admin_panel_settings';
  tone: Tone;
  metric: MetricEnvelope<number> | undefined;
  format?: (value: number) => string;
  sub: ReactNode;
}) {
  return (
    <div
      className={cn(
        'group relative flex flex-col justify-between overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-card p-4 shadow-md transition-all',
        TONE_HOVER[tone],
      )}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">{label}</span>
        <Icon name={icon} size={20} className={TONE_TEXT[tone]} />
      </div>
      <Stat metric={metric} className={cn('font-headline text-3xl font-bold', TONE_TEXT[tone])} format={format} label={label} />
      <div className="mt-3 flex items-center justify-between border-t border-outline-variant/30 pt-2 font-mono text-[10px]">{sub}</div>
      <div aria-hidden="true" className="absolute bottom-0 left-0 h-0.5 w-full bg-surface-container-highest">
        <div className={cn('h-full w-full', TONE_BAR[tone])} />
      </div>
    </div>
  );
}
