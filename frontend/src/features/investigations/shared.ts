/** Constants and the small helper the Investigations screen parts share. */
import { describeError } from '../../api/client';
import type { InvestigationStatus, VerdictClass } from '../../api/types';
import { type Loaded } from './Dossier';
import { STATUS_LABEL, VERDICT_LABEL, type PillTone } from './labels';

export const PAGE_SIZE = 20;
export const SEARCH_DEBOUNCE_MS = 300;

/** Left accent strip colour, keyed by the card's tone (SKILL section 3). */
export const ACCENT: Record<PillTone, string> = {
  primary: 'bg-primary',
  secondary: 'bg-secondary',
  tertiary: 'bg-tertiary',
  error: 'bg-error',
  neutral: 'bg-outline',
};

/** Verdict/status badge classes in the reference's exact style (hex mapped to tokens). */
export const BADGE: Record<PillTone, string> = {
  error: 'bg-error-container/40 text-error border border-error/40',
  tertiary: 'bg-tertiary-container/20 text-tertiary border border-tertiary/40',
  secondary: 'bg-secondary-container/20 text-secondary border border-secondary/40',
  primary: 'bg-primary-container/20 text-primary border border-primary/40',
  neutral: 'bg-surface-container-high text-on-surface-variant border border-outline-variant/40',
};

export const STATUS_OPTIONS: ReadonlyArray<{ value: InvestigationStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'queued', label: STATUS_LABEL.queued },
  { value: 'investigating', label: STATUS_LABEL.investigating },
  { value: 'verdict_reached', label: STATUS_LABEL.verdict_reached },
  { value: 'contained', label: STATUS_LABEL.contained },
  { value: 'ambiguous', label: STATUS_LABEL.ambiguous },
  { value: 'error', label: STATUS_LABEL.error },
];

export const VERDICT_OPTIONS: ReadonlyArray<{ value: VerdictClass | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'All verdict classes' },
  ...(Object.keys(VERDICT_LABEL) as VerdictClass[]).map((value) => ({ value, label: VERDICT_LABEL[value] })),
];

export const HINT = [
  'Pick a case on the left to open its dossier on the right: the verdict, the evidence bundle digest, the Watchdog’s check of each cited row and any sandbox containment.',
  'Search matches the start of the case id, the verdict class or the trigger type, and the Filters menu narrows the list by status, verdict class and primary agent; the server applies both (GET /investigations).',
  'Confidence on a card is agent-reported (the mean of the supporting agents’ self-reported confidence), not accuracy; the info button beside a number shows its source.',
] as const;

export function settled<T>(result: PromiseSettledResult<T>): Loaded<T> {
  return result.status === 'fulfilled' ? { data: result.value } : { error: describeError(result.reason) };
}
