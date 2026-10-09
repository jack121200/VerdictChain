import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FleetEntry, Me, Metric, Settings, SystemStatus } from '../../api/types';
import { fullStats } from '../../test/fixtures';

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

const makeStats = fullStats;

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

  it('selects a card without nesting buttons, and a Proof click leaves the selection alone', async () => {
    vi.mocked(getAgentFleet).mockResolvedValue([AGENT, { ...AGENT, agent_id: 'access_log', display_name: 'Access-Log' }]);
    const { container } = render(<FleetPage />);
    const second = await screen.findByRole('button', { name: 'Select Access-Log' });
    // A button inside a button is invalid HTML and React logs it; the Proof triggers live inside the cards.
    expect(container.querySelectorAll('button button')).toHaveLength(0);
    expect(second.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(second);
    expect(second.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getAllByRole('button', { name: /^Proof: Credibility, Network-Traffic/ })[0]);
    expect(second.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the fault-injection and quarantine controls with the capabilities', async () => {
    vi.mocked(getMe).mockResolvedValue(me(['override_fault_weights', 'quarantine_agent']));
    render(<FleetPage />);
    expect(await screen.findByRole('button', { name: /Run dry run/i })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /Quarantine agent/i })).toBeTruthy();
  });
});
