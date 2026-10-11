/** Small pieces the Fleet screen parts share. */
import { type ReactNode } from 'react';
import type { InvestigatorId, Metric as MetricEnvelope } from '../../api/types';
import { AGENT_VISUALS, type AgentTone, type AgentVisualId } from '../../lib/agents';
import { cn } from '../../lib/cn';
import { formatCount, formatPercent } from '../../lib/format';
import { FOCUS_RING } from '../../ui/classes';
import { Proof } from '../../ui/Proof';

export type ServiceKey = 'watchdog' | 'self_healing';
export type SelectionKey = InvestigatorId | ServiceKey;

export const percent = (value: number): string => formatPercent(value, 1);

/** A production CrS the dry run read from Redis, as a Metric so it carries its source and definition. */
export function productionCrs(value: number): MetricEnvelope<number> {
  return {
    value,
    n: 1,
    as_of: new Date().toISOString(),
    source: 'POST /agents/{id}/fault-injection',
    definition: 'Production credibility score read from Redis by the dry run, before or after it ran.',
    reason: null,
  };
}

/** Square agent glyph avatar, tone from SKILL section 5 (reference avatarColor). */
export const AVATAR_CLASS: Record<AgentTone, string> = {
  primary: 'border-primary text-primary bg-primary/10',
  secondary: 'border-secondary text-secondary bg-secondary/10',
  tertiary: 'border-tertiary text-tertiary bg-tertiary/10',
  'primary-container': 'border-primary-container text-secondary bg-on-primary-container',
  error: 'border-error/40 text-error bg-error-container/30',
};

export function Avatar({ agentId, size = 'sm' }: { agentId: AgentVisualId; size?: 'sm' | 'lg' }) {
  const visual = AGENT_VISUALS[agentId];
  return (
    <div
      aria-hidden="true"
      className={cn(
        'flex items-center justify-center border font-headline font-bold',
        size === 'lg' ? 'h-12 w-12 rounded-xl text-2xl' : 'h-10 w-10 rounded-lg text-lg',
        AVATAR_CLASS[visual.tone],
      )}
    >
      {visual.glyph}
    </div>
  );
}

/** Colored live figure with a Proof popover: null renders an em dash plus reason, never 0. */
export function Figure({
  metric,
  tone = 'text-on-surface',
  format,
  label,
  className,
}: {
  metric: MetricEnvelope<number> | undefined;
  tone?: string;
  format?: (value: number) => string;
  label: string;
  className: string;
}) {
  const value = metric?.value ?? null;
  const text = metric && value !== null ? (format ? format(value) : formatCount(value)) : '—';
  return (
    <span className="inline-flex flex-wrap items-baseline gap-1.5">
      <span className={cn(className, value === null ? 'text-on-surface-variant' : tone)}>{text}</span>
      {metric && value === null ? <span className="text-caption text-on-surface-variant">{metric.reason ?? 'no data reported'}</span> : null}
      {metric ? (
        <Proof source={metric.source} n={metric.n} asOf={metric.as_of} definition={metric.definition} reason={metric.reason} label={label} />
      ) : null}
    </span>
  );
}

export function HudTile({ label, children, sub, subTone }: { label: string; children: ReactNode; sub: ReactNode; subTone?: string }) {
  return (
    <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low/80 p-4 backdrop-blur-md">
      <div className="font-mono text-[10px] uppercase text-on-surface-variant">{label}</div>
      <div className="mt-1">{children}</div>
      <div className={cn('mt-1 font-mono text-[10px]', subTone ?? 'text-on-surface-variant')}>{sub}</div>
    </div>
  );
}

export function BoxLabel({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="flex items-center justify-between font-mono text-[10px] font-semibold uppercase text-outline">
      <span>{children}</span>
      {trailing}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 font-mono text-xs">
      <span className="text-on-surface-variant">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

/**
 * A selectable card. The select button comes first and covers the whole card; the Proof buttons inside the
 * card are positioned later in the DOM, so they paint above it and stay clickable. (A card that was itself a
 * <button> would nest the Proof buttons inside a button, which is invalid HTML.)
 */
export function SelectCard({
  label,
  selected,
  onSelect,
  className,
  children,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'relative flex flex-col justify-between rounded-xl border p-4 text-left transition-all',
        selected
          ? 'border-primary bg-surface-card shadow-glow-cyan ring-1 ring-primary/50'
          : 'border-outline-variant/40 bg-surface-container-low/70 hover:border-outline-variant hover:bg-surface-card/60',
        className,
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={label}
        className={cn('absolute inset-0 cursor-pointer rounded-xl', FOCUS_RING)}
      />
      {children}
    </div>
  );
}

export function InspectorShell({ children }: { children: ReactNode }) {
  return (
    <div className="sticky top-24 space-y-5 rounded-2xl border border-outline-variant/50 bg-surface-container-low p-5 shadow-2xl backdrop-blur-xl">
      {children}
    </div>
  );
}
