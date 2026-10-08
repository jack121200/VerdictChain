import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FleetEntry, Me, Metric, Settings, StatsResponse, SystemStatus } from '../../api/types';

vi.mock('../../api/client', () => ({
  describeError: (error: unknown) => String(error),
  getAgentFleet: vi.fn(),
  getCredibilityHistory: vi.fn(),
  getMe: vi.fn(),
  getSettings: vi.fn(),
  getStats: vi.fn(),
  getSystemStatus: vi.fn(),
  injectFault: vi.fn(),
  quarantineAgent: vi.fn(),
  restoreAgent: vi.fn(),
}));

import { getAgentFleet, getCredibilityHistory, getMe, getSettings, getStats, getSystemStatus } from '../../api/client';
import FleetPage from './index';

const metric = (value: number | null, reason: string | null = null): Metric<number> => ({
  value,
  n: value === null ? 0 : 3,
  as_of: '2026-10-08T00:00:00Z',
  source: 'test',
  definition: 'test definition',
  reason: value === null ? (reason ?? 'no data yet') : null,
});

function makeStats(overrides: Partial<StatsResponse> = {}): StatsResponse {
  return {
    threats_24h: metric(0),
    active: metric(0),
    insider_count: metric(0),
    mean_agent_confidence: metric(0.5),
    mean_crs: metric(0.914),
    citations: { total: metric(50), verified: metric(48), discrepancy: metric(1), invalid_row: metric(1), verified_rate: metric(0.96) },
    self_healing: { actions_total: metric(14), non_simulated: metric(0), simulated_share: metric(1) },
    watchdog: { checks: metric(8), citations_checked: metric(50), discrepancies: metric(1), isolations: metric(0) },
    feedback: { total: metric(0), confirmed: metric(0), false_positive: metric(0) },
    brier: metric(null),
    ...overrides,
  };
}

const AGENT: FleetEntry = {
  agent_id: 'network_traffic',
  display_name: 'Network-Traffic',
  domain: 'network traffic flows',
  signals: ['tls flow entropy', 'port scan bursts'],
  provider_chain: ['groq', 'gemini'],
  model: 'test-model-x',
  temperature: metric(0.2),
  crs: metric(0.9),
  isolated: false,
  rounds_scored: metric(3),
  citations_verified: metric(10),
  citations_total: metric(12),
  invalid_rate: metric(0.1),
  last_vote: 'ddos',
};

const SETTINGS: Settings = {
  eta: 0.15,
  isolation_threshold: 0.3,
  verdict_confidence_threshold: 0.8,
  intake_paused: false,
  debate_rounds: 3,
  starting_crs: 0.5,
  updated_at: null,
  updated_by: null,
};

const STATUS = { sandbox: { is_simulated_violations: metric(0), actions_total: metric(14) } } as unknown as SystemStatus;

function me(capabilities: Me['capabilities']): Me {
  return { analyst_id: 'abc', username: 'analyst', role: 'forensic_analyst', capabilities, token_expires_at: '2026-10-09T00:00:00Z' };
}

beforeEach(() => {
  vi.mocked(getAgentFleet).mockResolvedValue([AGENT]);
  vi.mocked(getStats).mockResolvedValue(makeStats());
  vi.mocked(getSettings).mockResolvedValue(SETTINGS);
  vi.mocked(getSystemStatus).mockResolvedValue(STATUS);
  vi.mocked(getCredibilityHistory).mockResolvedValue([]);
  vi.mocked(getMe).mockResolvedValue(me([]));
});

describe('FleetPage', () => {
  it('renders real fleet fields from the API', async () => {
    render(<FleetPage />);
    expect(await screen.findAllByText('Network-Traffic')).not.toHaveLength(0);
    expect(await screen.findAllByText('network traffic flows')).not.toHaveLength(0);
    // crs 0.9 -> 90.0% appears on the card and the inspector
    expect(await screen.findAllByText('90.0%')).not.toHaveLength(0);
    // the real model name is shown in the inspector
    expect(await screen.findByText('test-model-x')).toBeTruthy();
  });

  it('shows an em dash and the reason for a null metric, never 0', async () => {
    vi.mocked(getStats).mockResolvedValue(makeStats({ mean_crs: metric(null, 'no investigations yet') }));
    render(<FleetPage />);
    expect(await screen.findByText('no investigations yet')).toBeTruthy();
  });

  it('hides capability-gated controls without the capability', async () => {
    render(<FleetPage />);
    // inspector renders for the first investigator
    expect(await screen.findByText(/requires the override_fault_weights capability/i)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Quarantine agent$/ })).toBeNull());
  });

  it('shows the fault-injection and quarantine controls with the capabilities', async () => {
    vi.mocked(getMe).mockResolvedValue(me(['override_fault_weights', 'quarantine_agent']));
    render(<FleetPage />);
    expect(await screen.findByRole('button', { name: /Run dry run/i })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /Quarantine agent/i })).toBeTruthy();
  });
});
