import type { LiveGroup, LiveWindow } from '../../api/types';

/** The flag sits at this suspicion for every group (backend/pipeline/live_detector.py). */
export const FLAG_SUSPICION = 0.5;

const CERT_RULE =
  'z = (window mean of the field − dataset mean) / (dataset std / √rows in the window), over the 20 newest rows of this source. ' +
  'The window is flagged when z ≥ 4. suspicion = clamp(z / 8, 0, 1), so the flag sits at 0.5. ' +
  'The dataset mean and std come from every row of this source in raw_logs; no label is read.';

/** How each window is scored. Mirrors backend/pipeline/live_detector.py; shown in the Proof of every gauge. */
export const RULE_DEFINITION: Record<LiveGroup, string> = {
  network:
    'spread = population standard deviation of log10(1 + Flow Packets/s) over the 30 newest flows. ' +
    'The window is flagged when the spread is at most 0.50, that is, when the flows are near-identical in packet rate ' +
    '(a flood, a scan, repeated login attempts or a beacon). suspicion = clamp(1 − spread / 1.0, 0, 1), so the flag sits at 0.5.',
  logon: `Field: off_hours (1 or 0 per row). ${CERT_RULE}`,
  device: `Field: connect_count. ${CERT_RULE}`,
  file: `Field: file_access_count. ${CERT_RULE}`,
};

/** What the number in a window means, for its label. */
export function valueLabel(group: LiveGroup): string {
  return group === 'network' ? 'spread' : 'window mean';
}

/** The threshold reads "at most" for the network group (a small spread is the signal) and "at least" for the rest. */
export function thresholdLabel(group: LiveGroup): string {
  return group === 'network' ? 'flag at ≤' : 'flag at ≥';
}

export type WindowState = 'filling' | 'flagged' | 'normal';

/** filling: the window has not reached its size yet; flagged: the rule flagged the last full window. */
export function windowState(window: LiveWindow): WindowState {
  if (window.flagged) return 'flagged';
  if (window.rows < window.size || window.value === null) return 'filling';
  return 'normal';
}

/** Share of the window that is filled, 0..1. */
export function fillRatio(window: LiveWindow): number {
  return window.size > 0 ? Math.min(1, window.rows / window.size) : 0;
}
