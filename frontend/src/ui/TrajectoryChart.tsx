import { cn } from '../lib/cn';
import { formatCount, formatNumber } from '../lib/format';
import type { Tone } from './classes';
import { Proof, type ProofProps } from './Proof';

export interface TrajectoryPoint {
  x: number;
  y: number;
}

export interface TrajectorySeries {
  id: string;
  label: string;
  tone: Tone;
  points: readonly TrajectoryPoint[];
}

export interface TrajectoryChartProps {
  series: readonly TrajectorySeries[];
  /** Domain of the x axis, for example [1, 3] for rounds. */
  xDomain: readonly [number, number];
  /** Domain of the y axis. Defaults to [0, 1] for ratios such as CrS. */
  yDomain?: readonly [number, number];
  /** Horizontal reference line, for example the isolation threshold. */
  threshold?: { value: number; label: string };
  xLabel: string;
  yLabel: string;
  /** Accessible summary of the chart. */
  label: string;
  /** Proof for the plotted values (source, n, as_of, definition, inputs). Plan R5. */
  proof?: Omit<ProofProps, 'label' | 'className'>;
  className?: string;
}

const WIDTH = 640;
const HEIGHT = 240;
const MARGIN = { top: 16, right: 16, bottom: 36, left: 48 };

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

const LEGEND_CLASS: Record<Tone, string> = {
  primary: 'bg-primary',
  secondary: 'bg-secondary',
  tertiary: 'bg-tertiary',
  error: 'bg-error',
};

/** Line chart with real points only. Hand-written SVG (no chart library), data via props. */
export function TrajectoryChart({
  series,
  xDomain,
  yDomain = [0, 1],
  threshold,
  xLabel,
  yLabel,
  label,
  proof,
  className,
}: TrajectoryChartProps) {
  const [x0, x1] = xDomain;
  const [y0, y1] = yDomain;
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const sx = (x: number) => MARGIN.left + ((x - x0) / (x1 - x0 || 1)) * plotWidth;
  const sy = (y: number) => MARGIN.top + (1 - (y - y0) / (y1 - y0 || 1)) * plotHeight;

  const yTicks = [0, 1, 2, 3, 4].map((step) => y0 + (step / 4) * (y1 - y0));
  // Round numbers (for example 1, 2, 3) get one tick each, so no label repeats after rounding.
  const integerDomain = Number.isInteger(x0) && Number.isInteger(x1) && x1 - x0 <= 10;
  const xTicks = integerDomain
    ? Array.from({ length: Math.max(0, x1 - x0) + 1 }, (_, step) => x0 + step)
    : [0, 1, 2, 3, 4].map((step) => x0 + (step / 4) * (x1 - x0));
  const hasPoints = series.some((line) => line.points.length > 0);

  return (
    <figure className={cn('w-full', className)}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label} className="h-auto w-full overflow-visible">
        {yTicks.map((tick) => (
          <g key={`y-${tick}`}>
            <line
              x1={MARGIN.left}
              x2={WIDTH - MARGIN.right}
              y1={sy(tick)}
              y2={sy(tick)}
              strokeWidth={1}
              className="stroke-outline-variant/40"
            />
            <text x={MARGIN.left - 8} y={sy(tick)} textAnchor="end" dominantBaseline="middle" className="fill-on-surface-variant text-label">
              {formatNumber(tick, 2)}
            </text>
          </g>
        ))}
        {xTicks.map((tick, index) => (
          <text key={`x-${index}`} x={sx(tick)} y={HEIGHT - MARGIN.bottom + 16} textAnchor="middle" className="fill-on-surface-variant text-label">
            {integerDomain ? formatCount(tick) : formatNumber(tick, 1)}
          </text>
        ))}
        <text x={WIDTH / 2} y={HEIGHT - 4} textAnchor="middle" className="fill-on-surface-variant text-label uppercase">
          {xLabel}
        </text>
        <text x={12} y={HEIGHT / 2} textAnchor="middle" transform={`rotate(-90 12 ${HEIGHT / 2})`} className="fill-on-surface-variant text-label uppercase">
          {yLabel}
        </text>
        {threshold && (
          <g>
            <line
              x1={MARGIN.left}
              x2={WIDTH - MARGIN.right}
              y1={sy(threshold.value)}
              y2={sy(threshold.value)}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              className="stroke-error"
            />
            <text x={WIDTH - MARGIN.right} y={sy(threshold.value) - 4} textAnchor="end" className="fill-error text-label uppercase">
              {threshold.label}
            </text>
          </g>
        )}
        {series.map((line) => (
          <g key={line.id}>
            {line.points.length > 1 && (
              <polyline
                points={line.points.map((point) => `${sx(point.x)},${sy(point.y)}`).join(' ')}
                fill="none"
                strokeWidth={2}
                strokeLinejoin="round"
                className={STROKE_CLASS[line.tone]}
              />
            )}
            {line.points.map((point, index) => (
              <circle key={`${line.id}-${index}`} cx={sx(point.x)} cy={sy(point.y)} r={2.5} className={DOT_CLASS[line.tone]} />
            ))}
          </g>
        ))}
        {!hasPoints && (
          <text x={WIDTH / 2} y={HEIGHT / 2} textAnchor="middle" className="fill-on-surface-variant text-caption">
            no points yet
          </text>
        )}
      </svg>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-on-surface-variant">
        {series.map((line) => (
          <span key={line.id} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={cn('inline-block h-0.5 w-4 rounded', LEGEND_CLASS[line.tone])} />
            {line.label}
          </span>
        ))}
        {proof && <Proof {...proof} label={label} />}
      </figcaption>
    </figure>
  );
}
