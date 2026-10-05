import { cn } from '../lib/cn';

/** Loading placeholder. Pulses, and stops under prefers-reduced-motion (tokens.css). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded bg-surface-container-high', className)} />;
}
