import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Capability,
  CredibilityRow,
  FleetEntry,
  GlobalCitation,
  InvestigatorId,
  Metric,
  Settings,
} from '../../api/types';

const client = vi.hoisted(() => ({
  getAdaptiveThreshold: vi.fn(),
  getEvaluation: vi.fn(),
  getAgentFleet: vi.fn(),
  getCredibilityHistory: vi.fn(),
  getMe: vi.fn(),
  getSettings: vi.fn(),
  getStats: vi.fn(),
  getSystemStatus: vi.fn(),
  listCitations: vi.fn(),
  updateSettings: vi.fn(),
  describeError: (error: unknown) => String(error),
}));

vi.mock('../../api/client', () => client);

import { evidenceOutsideMono } from '../../test/evidence';
import { evaluationFixture } from '../../test/fixtures';
import TrustPage from './index';

function metric(value: number | null, reason: string | null = null): Metric<number> {
  return { value, n: value === null ? 0 : 1, as_of: '2026-10-05T00:00:00Z', source: '/x', definition: 'd', reason };
}

function fleetEntry(agentId: InvestigatorId, crs: number | null): FleetEntry {
  return {
    agent_id: agentId,
    display_name: agentId,
    domain: 'traffic',
    signals: [],
    provider_chain: ['openai'],
    model: 'test-model',
    temperature: metric(0.2),
    crs: metric(crs),
    isolated: false,
    rounds_scored: metric(crs === null ? 0 : 3),
    citations_verified: metric(8),
    citations_total: metric(10),
    invalid_rate: metric(0),
    last_vote: null,
  };
}

const settings: Settings = {
  eta: 0.15,
  isolation_threshold: 0.3,
  verdict_confidence_threshold: 0.8,
  intake_paused: false,
  debate_rounds: 3,
  starting_crs: 0.5,
  updated_at: null,
  updated_by: null,
};

const citation: GlobalCitation = {
  investigation_id: 'inv12345-xyz',
  row_id: 'row98765-abc',
  field: 'user_id',
  value: 'u-7',
  expected: 'u-7',
  status: 'VERIFIED',
  reason: 'ok',
  agent_id: 'network_traffic',
  round: 1,
  row_fingerprint: 'ff00',
};

function setup(options: { meanCrs?: number | null; capabilities?: Capability[]; history?: CredibilityRow[] } = {}) {
  const { meanCrs = 0.903, capabilities = ['edit_settings'], history = [] } = options;
  client.getAdaptiveThreshold.mockResolvedValue({
    threshold: metric(0.8),
    window: metric(0),
    false_positive_share: metric(null, 'no analyst feedback yet'),
    next_step: 'wait',
    reason: '0 of the 10 feedback rows needed',
    new_threshold: null,
    rule: { window_size: 20, min_feedback: 10, adapt_every: 5, tighten_at: 0.3, relax_at: 0.05, step_up: 0.02, step_down: 0.01, floor: 0.7, ceiling: 0.95 },
    last_change: null,
  });
  client.getEvaluation.mockResolvedValue(evaluationFixture('model', 0));
  client.getAgentFleet.mockResolvedValue([
    fleetEntry('network_traffic', 0.9),
    fleetEntry('access_log', 0.85),
    fleetEntry('endpoint_behavior', 0.72),
  ]);
  client.getCredibilityHistory.mockResolvedValue(history);
  client.getMe.mockResolvedValue({ analyst_id: 'a1', username: 'lead', role: 'secops_lead', capabilities, token_expires_at: '2026-10-06T00:00:00Z' });
  client.getSettings.mockResolvedValue(settings);
  client.getStats.mockResolvedValue({ mean_crs: metric(meanCrs, meanCrs === null ? 'no scored rounds yet' : null) } as unknown as Awaited<ReturnType<typeof client.getStats>>);
  client.getSystemStatus.mockResolvedValue({ sandbox: { is_simulated_violations: metric(0) } } as unknown as Awaited<ReturnType<typeof client.getSystemStatus>>);
  client.listCitations.mockResolvedValue({ items: [citation], total: metric(1), limit: 20, offset: 0 });
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('TrustPage', () => {
  it('renders the mean-CrS reliability from the API, not a typed number', async () => {
    setup({ meanCrs: 0.903 });
    render(<TrustPage />);
    expect(await screen.findByText('90.3%')).toBeTruthy();
  });

  it('shows every id and fingerprint of the citation ledger in the evidence font', async () => {
    setup();
    client.listCitations.mockResolvedValue({
      items: [
        {
          ...citation,
          investigation_id: 'e4c7c25e-02ff-44f4-aac1-530598a934cd',
          row_id: '574a5ec4-b50a-4be0-bb55-d96a032d8f92',
          row_fingerprint: 'd'.repeat(64),
        },
      ],
      total: metric(1),
      limit: 20,
      offset: 0,
    });
    const { container } = render(<TrustPage />);
    await screen.findByText('574a5ec4');
    await screen.findByText('e4c7c25e');

    expect(evidenceOutsideMono(container)).toEqual([]);
  });

  it('shows an em dash and the reason when mean CrS is null (never 0)', async () => {
    setup({ meanCrs: null });
    render(<TrustPage />);
    expect(await screen.findByText('no scored rounds yet')).toBeTruthy();
  });

  it('hides the policy sliders when the analyst lacks edit_settings', async () => {
    setup({ capabilities: [] });
    render(<TrustPage />);
    expect(await screen.findByText(/requires the/i)).toBeTruthy();
    expect(screen.queryByLabelText('Learning rate η')).toBeNull();
  });

  it('shows the policy sliders with edit_settings', async () => {
    setup({ capabilities: ['edit_settings'] });
    render(<TrustPage />);
    expect(await screen.findByLabelText('Learning rate η')).toBeTruthy();
    expect(screen.getByLabelText('Isolation threshold')).toBeTruthy();
    expect(screen.getByLabelText('Verdict confidence floor')).toBeTruthy();
  });

  it('refetches citations with the chosen status filter', async () => {
    setup();
    render(<TrustPage />);
    await screen.findByText('row98765'); // ledger rendered
    fireEvent.click(screen.getByRole('button', { name: 'Discrepancies' }));
    await waitFor(() =>
      expect(client.listCitations).toHaveBeenCalledWith(expect.objectContaining({ status: 'DISCREPANCY', offset: 0 })),
    );
  });

  it('derives the slider ticks from the range of each slider', async () => {
    setup({ capabilities: ['edit_settings'] });
    render(<TrustPage />);
    await screen.findByLabelText('Learning rate η');
    // Isolation threshold ranges 5% to 45%, so its ticks are 5%, 25% and 45%.
    const isolation = screen.getByLabelText('Isolation threshold').parentElement as HTMLElement;
    expect(isolation.textContent).toContain('5%');
    expect(isolation.textContent).toContain('25%');
    expect(isolation.textContent).toContain('45%');
    // Verdict floor ranges 50% to 99%: the middle tick is the real middle (about 75%), not a typed 80%.
    const floor = screen.getByLabelText('Verdict confidence floor').parentElement as HTMLElement;
    expect(floor.textContent).toContain('50%');
    expect(floor.textContent).toContain('75%');
    expect(floor.textContent).toContain('99%');
  });

  it('puts copy buttons on the shortened row and investigation ids in the citation ledger', async () => {
    setup();
    render(<TrustPage />);
    await screen.findByText('row98765');
    expect(screen.getByRole('button', { name: 'Copy cited row id' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy investigation id' })).toBeTruthy();
    expect(screen.getByText('row98765').getAttribute('title')).toBe('row98765-abc');
  });

  it('offers the next ledger page only when a full page came back, because the endpoint reports no total', async () => {
    setup();
    const full = Array.from({ length: 20 }, (_, index) => ({ ...citation, row_id: `row-${String(index).padStart(2, '0')}-zzzzzzzz` }));
    client.listCitations.mockResolvedValue({ items: full, total: metric(null, 'the citations endpoint pages without a total count'), limit: 20, offset: 0 });
    render(<TrustPage />);
    await screen.findByText('row-00-zz'.slice(0, 8));
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('rows 1–20')).toBeTruthy();
  });

  it('shows when the thresholds last changed as a relative time with the exact time in the tooltip', async () => {
    setup({ capabilities: ['edit_settings'] });
    client.getSettings.mockResolvedValue({ ...settings, updated_at: '2026-10-05T10:00:00Z', updated_by: 'lead' });
    const { container } = render(<TrustPage />);
    await screen.findByText(/Last changed by lead/);
    expect(container.querySelector('time[datetime="2026-10-05T10:00:00Z"]')?.getAttribute('title')).toBe('2026-10-05 10:00:00 UTC');
  });

  it('shows a dismissible how-to-read hint', async () => {
    setup();
    render(<TrustPage />);
    expect(screen.getByText('How to read this page')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss how-to-read hint' }));
    expect(screen.queryByText('How to read this page')).toBeNull();
    expect(window.localStorage.getItem('vc-hint-dismissed:trust')).toBe('1');
  });
});
