import { cn } from '../lib/cn';
import type { Tone } from './classes';

// A polyline is filled between its points unless fill is none, so the line gets stroke only.
const STROKE_CLASS: Record<Tone, string> = {
  primary: 'stroke-primary',
  secondary: 'stroke-secondary',
  tertiary: 'stroke-tertiary',
  error: 'stroke-error',
};

const DOT_CLASS: Record<Tone, string> = {
  primary: 'fill-primary',
  secondary: 'fill-secondary',
  tertiary: 'fill-tertiary',
  error: 'fill-error',
};

export interface SparklineProps {
  /** Real values only, in order. An empty array draws nothing. */
  values: readonly number[];
  /** Fixed domain. Defaults to the min and max of values. */
  min?: number;
  max?: number;
  width?: number;
  height?: number;
  tone?: Tone;
  /** Accessible summary, for example "Confidence by round, 3 points". */
  label: string;
  className?: string;
}

/** Inline line chart for a short series. Hand-written SVG, data via props only. */
export function Sparkline({ values, min, max, width = 120, height = 32, tone = 'primary', label, className }: SparklineProps) {
  if (values.length === 0) {
    return <span role="img" aria-label={`${label}: no data`} className={cn('inline-block', className)} style={{ width, height }} />;
  }
  const lo = min ?? Math.min(...values);
  const hi = max ?? Math.max(...values);
  const span = hi - lo || 1;
  const pad = 2;
  const x = (index: number) => (values.length === 1 ? width / 2 : pad + (index * (width - 2 * pad)) / (values.length - 1));
  const y = (value: number) => pad + (1 - (value - lo) / span) * (height - 2 * pad);
  const points = values.map((value, index) => `${x(index)},${y(value)}`).join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className={cn('overflow-visible', className)}>
      {values.length === 1 ? (
        <circle cx={x(0)} cy={y(values[0])} r={2.5} className={DOT_CLASS[tone]} />
      ) : (
        <polyline points={points} fill="none" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" className={STROKE_CLASS[tone]} />
      )}
    </svg>
  );
}
