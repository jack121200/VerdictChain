/** Tokens and constants the Debate Room parts share. */
import { formatPercent } from '../../lib/format';
import type { Tone } from '../../ui/classes';

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

export const TONE_PILL: Record<Tone | 'neutral', string> = {
  neutral: 'border-outline-variant/40 bg-surface-container-high text-on-surface-variant',
  primary: 'border-primary/40 bg-primary/10 text-primary',
  secondary: 'border-secondary/40 bg-secondary/10 text-secondary',
  tertiary: 'border-tertiary/40 bg-tertiary/10 text-tertiary',
  error: 'border-error/40 bg-error-container/30 text-error',
};

export const PERCENT1 = (value: number) => formatPercent(value, 1);
export const DEFAULT_TOTAL_ROUNDS = 3;
/** How often a running case is read again while the live socket is not open. */
export const POLL_WITHOUT_SOCKET_MS = 4000;

export type RoundFilter = 'all' | number;
