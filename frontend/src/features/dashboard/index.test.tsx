import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FleetEntry, InvestigatorId, Me } from '../../api/types';

const h = vi.hoisted(() => ({
  getStats: vi.fn(),
  getAgentFleet: vi.fn(),
  listScenarios: vi.fn(),
  getSettings: vi.fn(),
  getMe: vi.fn(),
  listAuditTrail: vi.fn(),
  listInvestigations: vi.fn(),
  getInvestigation: vi.fn(),
  getInvestigationCitations: vi.fn(),
  simulateInvestigation: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  getStats: h.getStats,
  getAgentFleet: h.getAgentFleet,
  listScenarios: h.listScenarios,
  getSettings: h.getSettings,
  getMe: h.getMe,
  listAuditTrail: h.listAuditTrail,
  listInvestigations: h.listInvestigations,
  getInvestigation: h.getInvestigation,
  getInvestigationCitations: h.getInvestigationCitations,
  simulateInvestigation: h.simulateInvestigation,
  describeError: (error: unknown) => (error instanceof Error ? error.message : 'error'),
}));

import DashboardPage from './index';

const metric = (value: number | null) => ({
  value,
  n: value === null ? 0 : 1,
  as_of: '2026-10-05T00:00:00Z',
  source: 'test',
  definition: 'test',
  reason: value === null ? 'no data' : null,
});

const fleetEntry = (agentId: InvestigatorId, name: string): FleetEntry => ({
  agent_id: agentId,
  display_name: name,
  domain: `${agentId} domain`,
  signals: [],
  provider_chain: ['groq'],
  model: 'provider-model',
  temperature: metric(0.2),
  crs: metric(0.9),
  isolated: false,
  rounds_scored: metric(3),
  citations_verified: metric(4),
  citations_total: metric(5),
  invalid_rate: metric(0.1),
  last_vote: 'botnet_c2',
});

const STATS = {
  threats_24h: metric(1),
  active: metric(2),
  insider_count: metric(1),
  mean_agent_confidence: metric(0.8),
  mean_crs: metric(0.9),
  citations: { total: metric(5), verified: metric(4), discrepancy: metric(1), invalid_row: metric(0), verified_rate: metric(0.8) },
  self_healing: { actions_total: metric(3), non_simulated: metric(0), simulated_share: metric(1) },
  watchdog: { checks: metric(1), citations_checked: metric(5), discrepancies: metric(1), isolations: metric(0) },
  feedback: { total: metric(0), confirmed: metric(0), false_positive: metric(0) },
  brier: metric(null),
};

const INVESTIGATION = {
  id: 'inv-dash-1',
  status: 'verdict_reached',
  verdict_class: 'botnet_c2',
  verdict_confidence: 0.8,
  primary_agent: 'network_traffic',
  dataset: 'CICIDS2017',
  noise_pct: 0,
  rounds_complete: 3,
  containment_count: 1,
  trigger_type: 'simulate',
  created_at: '2026-10-05T00:00:00Z',
};

const me = (capabilities: Me['capabilities']): Me => ({
  analyst_id: 'a-1',
  username: 'lead',
  role: 'secops_lead',
  capabilities,
  token_expires_at: '2026-10-06T00:00:00Z',
});

beforeEach(() => {
  h.getStats.mockResolvedValue(STATS);
  h.getAgentFleet.mockResolvedValue([fleetEntry('network_traffic', 'Network-Traffic'), fleetEntry('access_log', 'Access-Log'), fleetEntry('endpoint_behavior', 'Endpoint-Behavior')]);
  h.listScenarios.mockResolvedValue([
    { label: 'Botnet', dataset: 'CICIDS2017', primary_agent: 'network_traffic', row_count: metric(42), description: 'C2 beaconing flows' },
  ]);
  h.getSettings.mockResolvedValue({ eta: 0.15, isolation_threshold: 0.3, verdict_confidence_threshold: 0.8, intake_paused: false, debate_rounds: 3, starting_crs: 0.5, updated_at: null, updated_by: null });
  h.getMe.mockResolvedValue(me(['inject_scenario']));
  h.listAuditTrail.mockResolvedValue({
    entries: [
      { seq: 5, prev_hash: 'p', entry_hash: 'verdicthash5', hash_input: 'x', actor: 'system', action: 'verdict_reached', detail: null, investigation_id: 'inv-dash-1', created_at: '2026-10-05T00:00:05Z' },
    ],
    chain: { valid: true, head_seq: 5, total: 5 },
  });
  h.listInvestigations.mockResolvedValue({ items: [INVESTIGATION], total: metric(1), limit: 8, offset: 0 });
  h.getInvestigation.mockResolvedValue({
    ...INVESTIGATION,
    effective_noise_pct: 0,
    trigger_reason: null,
    rounds: [{ round: 1, agents: [{ agent_id: 'network_traffic', theory: 'C2 beacon on 8443', confidence: 0.8, stance: 'SUPPORT', provider: 'groq', cited_evidence: [], credibility: 0.9 }] }],
    citations: { total: 0, verified: 0, discrepancy: 0, invalid_row: 0, match_rate: metric(null) },
    credibility: [],
    actions: [],
    votes: [{ agent_id: 'network_traffic', verdict_class: 'botnet_c2', confidence: 0.8, matched_keywords: ['c2'] }],
  });
  h.getInvestigationCitations.mockResolvedValue({ summary: { total: 0, verified: 0, discrepancy: 0, invalid_row: 0, match_rate: metric(null) }, citations: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('DashboardPage', () => {
  it('renders real KPIs, pods, scenarios and the verdict ledger', async () => {
    render(<DashboardPage />);
    expect(await screen.findByText('Investigating now')).toBeTruthy();
    // The verdict ledger links to the latest investigation by its short id.
    expect((await screen.findAllByText('inv-dash')).length).toBeGreaterThan(0);
    // Pods come from the live fleet.
    expect((await screen.findAllByText('Network-Traffic')).length).toBeGreaterThan(0);
    // Scenario matrix is populated from GET /scenarios.
    expect(await screen.findByRole('option', { name: /Botnet/ })).toBeTruthy();
  });

  it('enables the inject button with the capability and disables it without', async () => {
    const view = render(<DashboardPage />);
    const inject = await screen.findByRole('button', { name: /inject simulation stream/i });
    await waitFor(() => expect((inject as HTMLButtonElement).disabled).toBe(false));

    view.unmount();
    h.getMe.mockResolvedValue(me([]));
    render(<DashboardPage />);
    const blocked = await screen.findByRole('button', { name: /inject simulation stream/i });
    await waitFor(() => expect((blocked as HTMLButtonElement).disabled).toBe(true));
  });
});
