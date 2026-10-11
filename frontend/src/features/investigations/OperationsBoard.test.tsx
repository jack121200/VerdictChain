import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvestigationSummary } from '../../api/types';
import { fullStats, metric } from '../../test/fixtures';

const client = vi.hoisted(() => ({
  getStats: vi.fn(),
  getSystemStatus: vi.fn(),
  listInvestigations: vi.fn(),
  describeError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

vi.mock('../../api/client', () => client);

import { OperationsBoard } from './OperationsBoard';

function summary(overrides: Partial<InvestigationSummary> = {}): InvestigationSummary {
  return {
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    status: 'investigating',
    verdict_class: null,
    verdict_confidence: null,
    primary_agent: 'network_traffic',
    dataset: 'CICIDS2017',
    noise_pct: 0,
    rounds_complete: 1,
    containment_count: 0,
    data_source: 'model',
    error_reason: null,
    trigger_type: 'continuous',
    created_at: new Date(Date.now() - 20_000).toISOString(),
    ...overrides,
  };
}

const page = (items: InvestigationSummary[]) => ({ items, total: metric(items.length), limit: 20, offset: 0 });

function slot(ids: string[], capacity: number | null = 4) {
  return {
    debate_slot: {
      status: ids.length > 0 ? 'running' : 'idle',
      investigation_id: ids[0] ?? null,
      running: metric(ids.length),
      capacity: metric(capacity),
      investigation_ids: ids,
    },
  };
}

/** The list endpoint answers by status, as the real one does. */
function serve(running: InvestigationSummary[], queued: InvestigationSummary[] = []) {
  client.listInvestigations.mockImplementation(async (params: { status?: string } = {}) => page(params.status === 'queued' ? queued : params.status === 'investigating' ? running : []));
}

beforeEach(() => {
  vi.clearAllMocks();
  client.getStats.mockResolvedValue(fullStats());
  client.getSystemStatus.mockResolvedValue(slot([]));
  serve([]);
});

describe('OperationsBoard scoreboard', () => {
  it('shows what the monitor started and finished with no click, each figure from /stats.automation', async () => {
    client.getStats.mockResolvedValue(
      fullStats({
        automation: {
          cases: metric(4),
          auto_started: metric(3),
          auto_share: metric(0.75),
          hands_free_contained: metric(1),
          median_seconds_to_verdict: metric(30),
          median_seconds_verdict_to_action: metric(3),
        },
      }),
    );
    render(<OperationsBoard rounds={3} />);

    expect(await screen.findByText('75%')).toBeTruthy();
    expect(screen.getByText('3 of 4 cases, 24 h')).toBeTruthy();
    expect(screen.getByText('30.0 s')).toBeTruthy();
    expect(screen.getByText('3.0 s')).toBeTruthy();
    expect(screen.getByText('Contained hands-free').nextElementSibling?.textContent).toContain('1');
  });

  it('shows an em dash with the reason for a figure with nothing behind it, never a 0', async () => {
    render(<OperationsBoard rounds={3} />);

    expect(await screen.findByText('no investigation reached a verdict in the last 24 hours')).toBeTruthy();
    expect(screen.getByText('no investigation was contained in the last 24 hours')).toBeTruthy();
    expect(screen.getByText('no investigation was accepted in the last 24 hours')).toBeTruthy();
  });

  it('can leave the scoreboard out (the Live page shows only the lanes)', async () => {
    render(<OperationsBoard rounds={3} showScoreboard={false} />);

    expect(await screen.findByText(/Parallel lanes/)).toBeTruthy();
    expect(screen.queryByText('Started by the monitor')).toBeNull();
  });
});

describe('OperationsBoard lanes', () => {
  it('draws one lane per debate slot: the running cases first, idle lanes for the rest', async () => {
    const first = summary({ id: 'aaaaaaaa-1111-2222-3333-444444444444', rounds_complete: 1 });
    const second = summary({ id: 'bbbbbbbb-1111-2222-3333-444444444444', rounds_complete: 3, trigger_type: 'manual', primary_agent: 'endpoint_behavior', dataset: 'CERT r4.2' });
    client.getSystemStatus.mockResolvedValue(slot([first.id, second.id]));
    serve([first, second]);
    render(<OperationsBoard rounds={3} />);

    expect(await screen.findByText('Parallel lanes · 2 of 4 busy')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Open the live debate aaaaaaaa' });
    expect(link.getAttribute('href')).toContain(first.id);
    expect(screen.getByText('round 2 of 3')).toBeTruthy(); // one round done: the second is under way
    expect(screen.getByText('verdict and containment')).toBeTruthy(); // all rounds done, still running
    expect(screen.getByText('live monitor')).toBeTruthy();
    expect(screen.getByText('analyst')).toBeTruthy();
    expect(screen.getAllByText('Idle · ready for the next flagged window')).toHaveLength(2);
  });

  it('lists the cases waiting for a free slot', async () => {
    const waiting = [summary({ id: 'cccccccc-1111-2222-3333-444444444444', status: 'queued', rounds_complete: 0 }), summary({ id: 'dddddddd-1111-2222-3333-444444444444', status: 'queued', rounds_complete: 0 })];
    serve([], waiting);
    render(<OperationsBoard rounds={3} />);

    expect(await screen.findByText('2 cases waiting for a free slot')).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Cases waiting for a debate slot' });
    expect(within(list).getByText('cccccccc')).toBeTruthy();
    expect(within(list).getByText('dddddddd')).toBeTruthy();
  });

  it('says nothing is waiting when the queue is empty', async () => {
    render(<OperationsBoard rounds={3} />);
    expect(await screen.findByText('nothing waiting')).toBeTruthy();
  });

  it('shows the running cases even when the slot capacity is not known', async () => {
    client.getSystemStatus.mockResolvedValue(slot(['aaaaaaaa-1111-2222-3333-444444444444'], null));
    serve([summary()]);
    render(<OperationsBoard rounds={null} />);

    expect(await screen.findByText('Parallel lanes · 1 of 1 busy')).toBeTruthy();
    expect(screen.getByText('round 2')).toBeTruthy(); // no total without the settings
  });

  it('reports a slot status that could not be read instead of drawing empty lanes', async () => {
    client.getSystemStatus.mockRejectedValue(new Error('status down'));
    render(<OperationsBoard rounds={3} />);

    expect((await screen.findByRole('alert')).textContent).toContain('The debate slots could not be read: status down');
  });
});
