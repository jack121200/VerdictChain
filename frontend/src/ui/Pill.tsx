import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import type { Tone } from './classes';
import { Icon } from './Icon';
import type { IconName } from './icon-names';

export interface PillProps {
  tone?: Tone | 'neutral';
  /** Status glyph. Colour is never the only signal (SKILL section 4). */
  icon?: IconName;
  children: ReactNode;
  className?: string;
}

const TONE_CLASS: Record<Tone | 'neutral', string> = {
  neutral: 'border-outline-variant/40 bg-surface-container-high text-on-surface-variant',
  primary: 'border-primary/40 bg-primary/10 text-primary',
  secondary: 'border-secondary/40 bg-secondary/10 text-secondary',
  tertiary: 'border-tertiary/40 bg-tertiary/10 text-tertiary',
  error: 'border-error/40 bg-error-container/30 text-error',
};

/** Rounded-full badge in the Label style (Inter 10/14, uppercase). */
export function Pill({ tone = 'neutral', icon, children, className }: PillProps) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-label uppercase', TONE_CLASS[tone], className)}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}
