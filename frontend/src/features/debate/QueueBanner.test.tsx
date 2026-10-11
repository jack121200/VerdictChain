import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvestigationProgress } from '../../api/types';

const h = vi.hoisted(() => ({ getInvestigationProgress: vi.fn() }));

vi.mock('../../api/client', () => ({
  getInvestigationProgress: h.getInvestigationProgress,
  describeError: (error: unknown) => String(error),
}));

import { QueueBanner } from './QueueBanner';

const INVESTIGATION = 'aaaaaaaa-1111-2222-3333-444444444444';
const RUNNING = 'bbbbbbbb-1111-2222-3333-444444444444';

function progress(over: Partial<InvestigationProgress> = {}): InvestigationProgress {
  return {
    investigation_id: INVESTIGATION,
    phase: 'queued',
    status: 'queued',
    rounds_total: 3,
    rounds_complete: 0,
    round: null,
    elapsed_seconds: 12.4,
    queue_position: 2,
    queue_length: 3,
    waiting_for: RUNNING,
    error_reason: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('QueueBanner', () => {
  it('shows the place in the queue and links to the debate that is running', async () => {
    h.getInvestigationProgress.mockResolvedValue(progress());
    const onLeftQueue = vi.fn();
    render(<QueueBanner investigationId={INVESTIGATION} onLeftQueue={onLeftQueue} />);

    expect(await screen.findByText(/Waiting in the debate queue · place 2 of 3/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'bbbbbbbb' }).getAttribute('href')).toBe(`#/debate/${RUNNING}`);
    expect(screen.getByText('waiting 12.4 s')).toBeTruthy();
    expect(onLeftQueue).not.toHaveBeenCalled();
  });

  it('tells the room once, when the case leaves the queue', async () => {
    h.getInvestigationProgress.mockResolvedValue(progress({ phase: 'running', status: 'investigating', queue_position: null, queue_length: null, waiting_for: null }));
    const onLeftQueue = vi.fn();
    render(<QueueBanner investigationId={INVESTIGATION} onLeftQueue={onLeftQueue} />);

    await waitFor(() => expect(onLeftQueue).toHaveBeenCalledTimes(1));
  });
});
