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
    provider_chain: ['groq'],
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
});
