import { cn } from '../lib/cn';
import { Icon } from './Icon';

export interface ProgressBarProps {
  /** Ratio in 0..1. null means no data: the track stays empty and says so. */
  value: number | null;
  /** Below this ratio the fill turns error red and a warning glyph shows (isolation threshold). */
  threshold?: number;
  /** Accessible name, for example "Credibility, network_traffic". */
  label: string;
  className?: string;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Credibility bar. Always shown with its number (SKILL section 8). */
export function ProgressBar({ value, threshold, label, className }: ProgressBarProps) {
  const ratio = value === null ? 0 : clamp01(value);
  const belowThreshold = value !== null && threshold !== undefined && value < threshold;
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value === null ? undefined : Math.round(ratio * 100)}
        aria-valuetext={value === null ? 'no data' : undefined}
        className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest"
      >
        <div
          className={cn('h-full rounded-full', belowThreshold ? 'bg-error' : 'bg-linear-to-r from-primary-container to-secondary')}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      {belowThreshold && <Icon name="warning" size={12} className="shrink-0 text-error" label="Below isolation threshold" />}
    </div>
  );
}
