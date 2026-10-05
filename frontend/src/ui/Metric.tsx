import type { Metric as MetricEnvelope } from '../api/types';
import { cn } from '../lib/cn';
import { formatCount, formatNumber } from '../lib/format';
import { Proof, type ProofInput } from './Proof';

export interface MetricProps<T extends number | string> {
  /** The envelope from the API. undefined means not loaded yet (renders an em dash). */
  metric: MetricEnvelope<T> | undefined;
  /** Display formatter. Integers get thousands separators, other numbers two decimals, strings as they are. */
  format?: (value: T) => string;
  /** Accessible name for the Proof popover, for example "Threat verdicts (24 h)". */
  label?: string;
  proofInputs?: readonly ProofInput[];
  /** kpi: Space Grotesk 24/32 for headline numbers. body: JetBrains Mono 12/16 for evidence values. */
  size?: 'kpi' | 'body';
  className?: string;
}

const VALUE_CLASS = {
  kpi: 'font-headline text-kpi tabular-nums',
  body: 'font-mono text-evidence tabular-nums',
} as const;

function defaultFormat(value: number | string): string {
  if (typeof value === 'string') return value;
  return Number.isInteger(value) ? formatCount(value) : formatNumber(value, 2);
}

/**
 * A live value with its Proof. When value is null the element shows an em dash and the reason.
 * It never shows 0 for missing data, and a real 0 renders as 0.
 */
export function Metric<T extends number | string>({
  metric,
  format,
  label,
  proofInputs,
  size = 'kpi',
  className,
}: MetricProps<T>) {
  if (!metric) {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-on-surface-variant', className)} aria-busy="true">
        <span className={VALUE_CLASS[size]}>—</span>
      </span>
    );
  }

  const value = metric.value;
  const text = value === null ? '—' : format ? format(value) : defaultFormat(value);

  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-2 gap-y-1', className)}>
      <span className={cn(VALUE_CLASS[size], value === null ? 'text-on-surface-variant' : 'text-on-surface')}>{text}</span>
      {value === null && (
        <span className="text-caption text-on-surface-variant">{metric.reason ?? 'no data reported'}</span>
      )}
      <Proof
        source={metric.source}
        n={metric.n}
        asOf={metric.as_of}
        definition={metric.definition}
        reason={metric.reason}
        inputs={proofInputs}
        label={label}
      />
    </span>
  );
}
