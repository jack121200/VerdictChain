import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvestigationSummary } from '../../api/types';

const h = vi.hoisted(() => ({ listInvestigations: vi.fn() }));

vi.mock('../../api/client', () => ({
  listInvestigations: h.listInvestigations,
  describeError: (error: unknown) => String(error),
}));

import { ScenarioModalContext } from '../../shell/scenario-modal';
import { DebateList } from './List';

function row(over: Partial<InvestigationSummary> = {}): InvestigationSummary {
  return {
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    status: 'verdict_reached',
    verdict_class: 'ddos',
    verdict_confidence: 0.9,
    primary_agent: 'network_traffic',
    dataset: 'CICIDS2017',
    noise_pct: 0,
    rounds_complete: 3,
    containment_count: 0,
    data_source: 'model',
    trigger_type: 'manual',
    created_at: '2026-10-05T12:00:00Z',
    ...over,
  };
}

const page = (items: InvestigationSummary[]) => ({ items, total: { value: null, n: 0, as_of: '', source: '', definition: '', reason: 'no total' }, limit: 50, offset: 0 });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DebateList', () => {
  it('lists live debates before finished ones, each linking to its room with a copy button and a time', async () => {
    h.listInvestigations.mockResolvedValue(
      page([row({ id: 'bbbbbbbb-1111', status: 'investigating', verdict_class: null }), row()]),
    );
    const { container } = render(<DebateList />);
    expect(await screen.findByText('Debating now (1)')).toBeTruthy();
    expect(screen.getByText('Recent (1)')).toBeTruthy();
    const live = screen.getByRole('link', { name: 'Open debate room bbbbbbbb' });
    expect(live.getAttribute('href')).toBe('#/debate/bbbbbbbb-1111');
    expect(screen.getAllByRole('button', { name: 'Copy investigation id' })).toHaveLength(2);
    expect(container.querySelector('time[datetime="2026-10-05T12:00:00Z"]')?.getAttribute('title')).toBe('2026-10-05 12:00:00 UTC');
    // A copy button may not sit inside a link.
    expect(container.querySelectorAll('a button')).toHaveLength(0);
  });

  it('lists queued cases in the order the worker takes them, with their place', async () => {
    h.listInvestigations.mockResolvedValue(
      page([
        row({ id: 'cccccccc-0003', status: 'queued', verdict_class: null, created_at: '2026-10-05T12:03:00Z' }),
        row({ id: 'bbbbbbbb-0002', status: 'queued', verdict_class: null, created_at: '2026-10-05T12:02:00Z' }),
        row({ id: 'aaaaaaaa-0001', status: 'investigating', verdict_class: null, created_at: '2026-10-05T12:01:00Z' }),
      ]),
    );
    render(<DebateList />);
    expect(await screen.findByText('Waiting in the queue (2)')).toBeTruthy();
    expect(screen.getByText('Debating now (1)')).toBeTruthy();
    const places = screen.getAllByText(/queued · place/).map((node) => node.textContent);
    expect(places).toEqual(['queued · place 1', 'queued · place 2']); // oldest first, whatever order the API sent
    expect(screen.queryByText('Recent (2)')).toBeNull(); // queued cases are not "recent"
  });

  it('with no debates at all, offers to run the first scenario', async () => {
    h.listInvestigations.mockResolvedValue(page([]));
    const open = vi.fn();
    render(
      <ScenarioModalContext.Provider value={{ canInject: true, open }}>
        <DebateList />
      </ScenarioModalContext.Provider>,
    );
    expect(await screen.findByText('No debates yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Run first scenario' }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('with only finished debates, says none is live and offers to run another', async () => {
    h.listInvestigations.mockResolvedValue(page([row()]));
    const open = vi.fn();
    render(
      <ScenarioModalContext.Provider value={{ canInject: true, open }}>
        <DebateList />
      </ScenarioModalContext.Provider>,
    );
    expect(await screen.findByText('No live debate')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Run a scenario' }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('No debates yet')).toBeNull();
  });

  it('shows a dismissible how-to-read hint', async () => {
    h.listInvestigations.mockResolvedValue(page([row()]));
    render(<DebateList />);
    expect(screen.getByText('How to read this page')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss how-to-read hint' }));
    expect(window.localStorage.getItem('vc-hint-dismissed:debate-list')).toBe('1');
    expect(screen.queryByText('How to read this page')).toBeNull();
  });
});
