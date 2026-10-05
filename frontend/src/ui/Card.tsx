import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import type { Tone } from './classes';

export interface CardProps {
  children: ReactNode;
  /** card: surface-card with shadow-md. panel: surface-container-low. */
  variant?: 'card' | 'panel';
  /** Hover border takes the agent or status colour at 50% (SKILL section 7). */
  hoverTone?: Tone;
  /** 2px top strip, primary to secondary to tertiary. Use on a screen's hero card only. */
  hairline?: boolean;
  className?: string;
  as?: 'div' | 'section' | 'article';
}

const VARIANT_CLASS = {
  card: 'bg-surface-card shadow-md',
  panel: 'bg-surface-container-low',
} as const;

const HOVER_CLASS: Record<Tone, string> = {
  primary: 'hover:border-primary/50',
  secondary: 'hover:border-secondary/50',
  tertiary: 'hover:border-tertiary/50',
  error: 'hover:border-error/50',
};

export function Card({ children, variant = 'card', hoverTone, hairline = false, className, as: Tag = 'div' }: CardProps) {
  return (
    <Tag
      className={cn(
        'relative overflow-hidden rounded-xl border border-outline-variant/40 p-4 transition-colors',
        VARIANT_CLASS[variant],
        hoverTone && HOVER_CLASS[hoverTone],
        className,
      )}
    >
      {hairline && (
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-linear-to-r from-primary via-secondary to-tertiary" />
      )}
      {children}
    </Tag>
  );
}
