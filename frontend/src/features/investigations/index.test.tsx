import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvestigationSummary, Metric } from '../../api/types';

const client = vi.hoisted(() => ({
  getAgentFleet: vi.fn(),
  getEvidenceBundle: vi.fn(),
  getInvestigation: vi.fn(),
  getInvestigationCitations: vi.fn(),
  listAuditTrail: vi.fn(),
  listInvestigations: vi.fn(),
  releaseContainment: vi.fn(),
  submitFeedback: vi.fn(),
  describeError: (error: unknown) => String(error),
}));

vi.mock('../../api/client', () => client);

import InvestigationsPage from './index';

function metric(value: number | null): Metric<number> {
  return { value, n: value === null ? 0 : 1, as_of: '2026-10-05T00:00:00Z', source: '/investigations', definition: 'd', reason: value === null ? 'none' : null };
}

function summary(overrides: Partial<InvestigationSummary> = {}): InvestigationSummary {
  return {
    id: 'inv12345-aaaa-bbbb',
    status: 'verdict_reached',
    verdict_class: 'ddos',
    verdict_confidence: 0.9,
    primary_agent: 'network_traffic',
    dataset: 'CICIDS2017',
    noise_pct: 0,
    rounds_complete: 3,
    containment_count: 1,
    trigger_type: 'traffic_spike',
    created_at: '2026-10-05T12:00:00Z',
    ...overrides,
  };
}

function page(items: InvestigationSummary[], total = items.length) {
  return { items, total: metric(total), limit: 20, offset: 0 };
}

beforeEach(() => {
  vi.clearAllMocks();
  client.getAgentFleet.mockResolvedValue([]);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('InvestigationsPage', () => {
  it('renders real case fields: short id, verdict label and agent-reported confidence', async () => {
    client.listInvestigations.mockResolvedValue(page([summary()]));
    render(<InvestigationsPage />);
    expect(await screen.findByText('inv12345')).toBeTruthy();
    // "DDoS" is the card badge (it also appears as a <select> option label).
    expect(screen.getAllByText('DDoS').length).toBeGreaterThanOrEqual(1);
    const conf = screen.getByText(/conf\./);
    expect(conf.textContent).toContain('90.0%');
  });

  it('shows an em dash for confidence when none is recorded (never 0)', async () => {
    client.listInvestigations.mockResolvedValue(page([summary({ verdict_class: null, verdict_confidence: null, status: 'running' })]));
    render(<InvestigationsPage />);
    expect(await screen.findByText('inv12345')).toBeTruthy();
    const conf = screen.getByText(/conf\./);
    expect(conf.textContent).toContain('—');
  });

  it('shows the empty state when no case matches the filters', async () => {
    client.listInvestigations.mockResolvedValue(page([]));
    render(<InvestigationsPage />);
    expect(await screen.findByText('No investigations match')).toBeTruthy();
  });

  it('refetches the list with the chosen verdict filter', async () => {
    client.listInvestigations.mockResolvedValue(page([summary()]));
    render(<InvestigationsPage />);
    await screen.findByText('inv12345');
    fireEvent.change(screen.getByLabelText('Verdict filter'), { target: { value: 'ddos' } });
    await waitFor(() =>
      expect(client.listInvestigations).toHaveBeenCalledWith(expect.objectContaining({ verdict_class: 'ddos', offset: 0 })),
    );
  });
});
