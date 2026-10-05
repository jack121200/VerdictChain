import { cn } from '../lib/cn';

/**
 * live: primary dot that pulses. alert: error dot that pings. ok, warn, error, idle: solid dots.
 * Shape is a dot in every case, colour is the only difference here, so pair it with text.
 */
export type StatusTone = 'live' | 'alert' | 'ok' | 'warn' | 'error' | 'idle';

const DOT_CLASS: Record<StatusTone, string> = {
  live: 'bg-primary animate-pulse',
  alert: 'bg-error',
  ok: 'bg-secondary',
  warn: 'bg-tertiary',
  error: 'bg-error',
  idle: 'bg-outline',
};

export interface StatusDotProps {
  tone: StatusTone;
  /** Accessible name for the dot. Without it the dot is decorative. */
  label?: string;
  className?: string;
}

export function StatusDot({ tone, label, className }: StatusDotProps) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('relative inline-flex h-2 w-2 shrink-0', className)}
    >
      {tone === 'alert' && <span className="absolute inset-0 animate-ping rounded-full bg-error opacity-75" />}
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', DOT_CLASS[tone])} />
    </span>
  );
}
