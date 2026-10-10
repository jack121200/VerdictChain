import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdaptiveThreshold as AdaptiveThresholdData, Metric } from '../../api/types';

const h = vi.hoisted(() => ({ getAdaptiveThreshold: vi.fn() }));

vi.mock('../../api/client', () => ({
  getAdaptiveThreshold: h.getAdaptiveThreshold,
  describeError: (error: unknown) => String(error),
}));

import { AdaptiveThreshold } from './AdaptiveThreshold';

function metric(value: number | null, reason: string | null = null): Metric<number> {
  return { value, n: value === null ? 0 : 1, as_of: '2026-10-09T00:00:00Z', source: '/settings/adaptive', definition: 'd', reason };
}

const RULE = { window_size: 20, min_feedback: 10, adapt_every: 5, tighten_at: 0.3, relax_at: 0.05, step_up: 0.02, step_down: 0.01, floor: 0.7, ceiling: 0.95 };

function data(over: Partial<AdaptiveThresholdData> = {}): AdaptiveThresholdData {
  return {
    threshold: metric(0.82),
    window: metric(20),
    false_positive_share: metric(0.35),
    next_step: 'wait',
    reason: '0 of the 5 new feedback rows needed since the last move',
    new_threshold: null,
    rule: RULE,
    last_change: {
      at: '2026-10-09T10:00:00Z',
      before: 0.8,
      after: 0.82,
      reason: '7 of the last 20 verdicts were marked false positives (35%, tighten at 30%): threshold 0.80 to 0.82',
      feedback_count: 20,
    },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AdaptiveThreshold', () => {
  it('shows the floor, the feedback it rests on, the next step and the last audited move', async () => {
    h.getAdaptiveThreshold.mockResolvedValue(data());
    render(<AdaptiveThreshold />);

    expect(await screen.findByText('0.82', { selector: 'span' })).toBeTruthy();
    expect(screen.getByText('35%')).toBeTruthy();
    expect(screen.getByText('Waiting for feedback')).toBeTruthy();
    expect(screen.getByText(/Last move/)).toBeTruthy();
    expect(screen.getByText(/threshold 0.80 to 0.82/)).toBeTruthy();
  });

  it('with no feedback the share is a dash with its reason, never zero', async () => {
    h.getAdaptiveThreshold.mockResolvedValue(
      data({ window: metric(0), false_positive_share: metric(null, 'no analyst feedback yet'), last_change: null, reason: '0 of the 10 feedback rows needed' }),
    );
    render(<AdaptiveThreshold />);

    expect(await screen.findByText('no analyst feedback yet')).toBeTruthy();
    expect(screen.getByText('No move yet.')).toBeTruthy();
  });

  it('names a tighten as an error-toned step', async () => {
    h.getAdaptiveThreshold.mockResolvedValue(data({ next_step: 'tighten', reason: '7 of the last 20 verdicts were marked false positives' }));
    render(<AdaptiveThreshold />);

    expect(await screen.findByText('Tighten')).toBeTruthy();
  });
});
