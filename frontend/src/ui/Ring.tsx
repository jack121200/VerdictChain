import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import type { Tone } from './classes';

const ARC_CLASS: Record<Tone, string> = {
  primary: 'stroke-primary',
  secondary: 'stroke-secondary',
  tertiary: 'stroke-tertiary',
  error: 'stroke-error',
};

export interface RingProps {
  /** Ratio in 0..1. null draws no arc. */
  value: number | null;
  size?: number;
  strokeWidth?: number;
  tone?: Tone;
  /** Centre content, usually a Metric. */
  children?: ReactNode;
  label: string;
  className?: string;
}

/** Circular gauge for one ratio. Shows nothing in the arc for missing data. */
export function Ring({ value, size = 64, strokeWidth = 6, tone = 'primary', children, label, className }: RingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = value === null ? 0 : Math.min(1, Math.max(0, value));
  return (
    <div
      role="img"
      aria-label={value === null ? `${label}: no data` : label}
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-surface-container-highest"
        />
        {value !== null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - ratio)}
            className={ARC_CLASS[tone]}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}
