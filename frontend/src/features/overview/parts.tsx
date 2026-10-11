/** Small pieces the Overview sections share: a live figure with its Proof, the ribbon tile, the pillar card and a footer row. */
import { type ReactNode } from 'react';
import type { Metric as MetricEnvelope } from '../../api/types';
import { cn } from '../../lib/cn';
import { formatCount, formatPercent } from '../../lib/format';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icon-names';
import { Proof } from '../../ui/Proof';

export const percent = (value: number): string => formatPercent(value, 1);

/** Colored live figure with a Proof popover; null renders an em dash, never 0. */
export function Figure({
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

export function RibbonTile({ label, dotClass, children, sub }: { label: string; dotClass: string; children: ReactNode; sub: string }) {
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

export function PillarCard({
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

export function FooterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <span className="text-on-surface">{children}</span>
    </div>
  );
}
