/** Tokens and the Stat primitive the Dashboard parts share. */
import type { InvestigationSummary, Metric as MetricEnvelope } from '../../api/types';
import { formatCount, formatPercent } from '../../lib/format';
import { type Tone } from '../../ui/classes';
import { Proof, type ProofInput } from '../../ui/Proof';
import { verdictClassTone } from './derive';

export const TONE_TEXT: Record<Tone, string> = {
  primary: 'text-primary',
  secondary: 'text-secondary',
  tertiary: 'text-tertiary',
  error: 'text-error',
};

export const TONE_GLYPH_BOX: Record<Tone, string> = {
  primary: 'bg-primary/10 border-primary/30 text-primary',
  secondary: 'bg-secondary/10 border-secondary/30 text-secondary',
  tertiary: 'bg-tertiary/10 border-tertiary/30 text-tertiary',
  error: 'bg-error-container/30 border-error/40 text-error',
};

export const TONE_HOVER: Record<Tone, string> = {
  primary: 'hover:border-primary/50',
  secondary: 'hover:border-secondary/50',
  tertiary: 'hover:border-tertiary/50',
  error: 'hover:border-error/50',
};

export const TONE_BAR: Record<Tone, string> = {
  primary: 'bg-primary',
  secondary: 'bg-secondary',
  tertiary: 'bg-tertiary',
  error: 'bg-error',
};

export const PERCENT0 = (value: number) => formatPercent(value, 0);
export const PERCENT1 = (value: number) => formatPercent(value, 1);

/**
 * A live value rendered in the reference's exact typography, backed by a Metric envelope: it
 * shows "—" with no fabricated number when value is null, and always carries a Proof (no-bluff R1/R2).
 */
export function Stat({
  metric,
  className,
  format = formatCount,
  label,
  proofInputs,
}: {
  metric: MetricEnvelope<number> | undefined;
  className?: string;
  format?: (value: number) => string;
  label: string;
  proofInputs?: readonly ProofInput[];
}) {
  const text = !metric || metric.value === null ? '—' : format(metric.value);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={className}>{text}</span>
      {metric && (
        <Proof
          source={metric.source}
          n={metric.n}
          asOf={metric.as_of}
          definition={metric.definition}
          reason={metric.reason}
          inputs={proofInputs}
          label={label}
        />
      )}
    </span>
  );
}

export function verdictPillClass(verdictClass: InvestigationSummary['verdict_class']): string {
  const tone = verdictClassTone(verdictClass);
  switch (tone) {
    case 'error':
      return 'border border-error/30 bg-error-container/40 text-error';
    case 'secondary':
      return 'border border-secondary/30 bg-secondary/20 text-secondary';
    case 'tertiary':
      return 'border border-tertiary/30 bg-tertiary/20 text-tertiary';
    default:
      return 'border border-outline-variant/40 bg-surface-container-high text-on-surface-variant';
  }
}
