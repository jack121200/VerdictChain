import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Citation,
  DebateRound,
  EvidenceBundleResponse,
  FleetEntry,
  InvestigationCitations,
  InvestigationDetail,
  InvestigationStatus,
  InvestigatorId,
  LiveFrame,
  Me,
  RoundAgentTurn,
  Vote,
} from '../../api/types';
import type { InvestigationSocketHandlers } from '../../api/socket';

const h = vi.hoisted(() => ({
  getInvestigation: vi.fn(),
  getInvestigationCitations: vi.fn(),
  getEvidenceBundle: vi.fn(),
  getAgentFleet: vi.fn(),
  getSettings: vi.fn(),
  getSystemStatus: vi.fn(),
  getMe: vi.fn(),
  getWsTicket: vi.fn(),
  signInvestigation: vi.fn(),
  connectInvestigationSocket: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  getInvestigation: h.getInvestigation,
  getInvestigationCitations: h.getInvestigationCitations,
  getEvidenceBundle: h.getEvidenceBundle,
  getAgentFleet: h.getAgentFleet,
  getSettings: h.getSettings,
  getSystemStatus: h.getSystemStatus,
  getMe: h.getMe,
  getWsTicket: h.getWsTicket,
  signInvestigation: h.signInvestigation,
  describeError: (error: unknown) => (error instanceof Error ? error.message : 'error'),
}));

vi.mock('../../api/socket', () => ({ connectInvestigationSocket: h.connectInvestigationSocket }));

import DebatePage from './index';

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

const FLEET: FleetEntry[] = [
  fleetEntry('network_traffic', 'Network-Traffic'),
  fleetEntry('access_log', 'Access-Log'),
  fleetEntry('endpoint_behavior', 'Endpoint-Behavior'),
];

const SETTINGS = {
  eta: 0.15,
  isolation_threshold: 0.3,
  verdict_confidence_threshold: 0.8,
  intake_paused: false,
  debate_rounds: 3,
  starting_crs: 0.5,
  updated_at: null,
  updated_by: null,
};

const SYSTEM_STATUS = {
  api_version: '2.4',
  migration_head: '0006',
  postgres: { ok: true, latency_ms: metric(1) },
  redis: { ok: true, latency_ms: metric(1) },
  rabbitmq: { ok: true, latency_ms: metric(1) },
  providers: {
    groq: { configured: true, model: 'provider-model', temperature: metric(0.2), calls_24h: metric(3) },
    gemini: { configured: false, model: null, temperature: metric(null), calls_24h: metric(0) },
  },
  sandbox: { is_simulated_violations: metric(0), actions_total: metric(0) },
  debate_slot: { state: 'idle', investigation_id: null },
  intake_paused: false,
  continuous_mode: false,
};

const me = (capabilities: Me['capabilities']): Me => ({
  analyst_id: 'a-1',
  username: 'lead',
  role: 'secops_lead',
  capabilities,
  token_expires_at: '2026-10-06T00:00:00Z',
});

const turn = (agentId: InvestigatorId, over: Partial<RoundAgentTurn> = {}): RoundAgentTurn => ({
  agent_id: agentId,
  theory: `${agentId} theory`,
  confidence: 0.8,
  stance: null,
  provider: 'groq',
  cited_evidence: [],
  credibility: 0.8,
  ...over,
});

const emptyCitations: InvestigationCitations = {
  summary: { total: 0, verified: 0, discrepancy: 0, invalid_row: 0, match_rate: metric(null) },
  citations: [],
};

const bundle: EvidenceBundleResponse = {
  bundle: {
    investigation_id: 'inv-1',
    verdict: { verdict_class: 'botnet_c2', verdict_confidence: 0.8, status: 'verdict_reached' },
    transcript: [],
    credibility: [],
    actions: [],
    citation_recheck: { total: 0, verified: 0, discrepancy: 0, invalid_row: 0, match_rate: metric(null) },
  },
  bundle_sha256: 'a'.repeat(64),
};

function detail(over: Partial<InvestigationDetail> = {}): InvestigationDetail {
  return {
    id: 'inv-1',
    status: 'verdict_reached',
    verdict_class: 'botnet_c2',
    verdict_confidence: 0.8,
    primary_agent: 'network_traffic',
    dataset: 'CICIDS2017',
    noise_pct: 0,
    effective_noise_pct: 0,
    trigger_type: 'simulate',
    trigger_reason: null,
    rounds: [],
    citations: emptyCitations.summary,
    credibility: [],
    actions: [],
    votes: [],
    created_at: '2026-10-05T00:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  h.getAgentFleet.mockResolvedValue(FLEET);
  h.getSettings.mockResolvedValue(SETTINGS);
  h.getSystemStatus.mockResolvedValue(SYSTEM_STATUS);
  h.getMe.mockResolvedValue(me(['sign_evidence_bundle', 'inject_scenario']));
  h.getInvestigationCitations.mockResolvedValue(emptyCitations);
  h.getEvidenceBundle.mockResolvedValue(bundle);
  h.getWsTicket.mockResolvedValue({ ticket: 'ticket-1', expires_in: 30 });
  h.connectInvestigationSocket.mockReturnValue({ close: vi.fn() });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('DebatePage', () => {
  it('opens a live socket when the case is running and renders round_completed frames', async () => {
    h.getInvestigation.mockResolvedValue(detail({ status: 'running' as InvestigationStatus, verdict_class: null, verdict_confidence: null }));
    render(<DebatePage id="inv-1" />);

    await waitFor(() => expect(h.connectInvestigationSocket).toHaveBeenCalledTimes(1));
    const handlers = h.connectInvestigationSocket.mock.calls[0][2] as InvestigationSocketHandlers;

    const frame: LiveFrame = {
      type: 'round_completed',
      investigation_id: 'inv-1',
      round: 1,
      agents: [turn('network_traffic', { theory: 'SUPPORT burst to port 8443 is a C2 beacon', stance: 'SUPPORT' })],
    };
    await act(async () => {
      handlers.onFrame(frame);
    });

    const matches = await screen.findAllByText('SUPPORT burst to port 8443 is a C2 beacon');
    expect(matches.length).toBeGreaterThan(0);
  });

  it('does not open a socket in replay (a finished case)', async () => {
    h.getInvestigation.mockResolvedValue(
      detail({ rounds: [{ round: 1, agents: [turn('network_traffic', { theory: 'finished theory' })] }] satisfies DebateRound[] }),
    );
    render(<DebatePage id="inv-1" />);

    await screen.findAllByText('finished theory');
    expect(h.connectInvestigationSocket).not.toHaveBeenCalled();
    expect(h.getWsTicket).not.toHaveBeenCalled();
    expect(await screen.findByText(/Replaying stored transcript/)).toBeTruthy();
  });

  it('shows the server-parsed stance, including "stance not stated" when null', async () => {
    h.getInvestigation.mockResolvedValue(
      detail({
        rounds: [
          {
            round: 1,
            agents: [turn('network_traffic', { stance: 'SUPPORT' }), turn('access_log', { stance: null })],
          },
        ],
      }),
    );
    render(<DebatePage id="inv-1" />);

    expect((await screen.findAllByText('SUPPORT')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('stance not stated')).length).toBeGreaterThan(0);
  });

  it('recomputes verdict confidence in the browser and confirms it matches the server', async () => {
    const votes: Vote[] = [
      { agent_id: 'network_traffic', verdict_class: 'botnet_c2', confidence: 0.8, matched_keywords: ['c2'] },
      { agent_id: 'access_log', verdict_class: 'botnet_c2', confidence: 0.8, matched_keywords: ['beacon'] },
    ];
    h.getInvestigation.mockResolvedValue(detail({ verdict_confidence: 0.8, votes }));
    render(<DebatePage id="inv-1" />);

    expect(await screen.findByText(/recompute matches server/i)).toBeTruthy();
    expect(screen.queryByText(/recompute mismatch/i)).toBeNull();
  });

  it('flags a mismatch when the server confidence differs from the recompute', async () => {
    const votes: Vote[] = [
      { agent_id: 'network_traffic', verdict_class: 'botnet_c2', confidence: 0.8, matched_keywords: [] },
      { agent_id: 'access_log', verdict_class: 'botnet_c2', confidence: 0.8, matched_keywords: [] },
    ];
    h.getInvestigation.mockResolvedValue(detail({ verdict_confidence: 0.95, votes }));
    render(<DebatePage id="inv-1" />);

    expect(await screen.findByText(/recompute mismatch/i)).toBeTruthy();
  });

  it('enables the sign-off button only with the sign_evidence_bundle capability', async () => {
    h.getInvestigation.mockResolvedValue(detail());
    h.getMe.mockResolvedValue(me(['inject_scenario']));
    const view = render(<DebatePage id="inv-1" />);

    const disabled = await screen.findByRole('button', { name: 'Record sign-off (audited)' });
    expect((disabled as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/does not grant sign_evidence_bundle/i)).toBeTruthy();

    view.unmount();
    h.getMe.mockResolvedValue(me(['sign_evidence_bundle']));
    render(<DebatePage id="inv-1" />);
    const enabled = await screen.findByRole('button', { name: 'Record sign-off (audited)' });
    await waitFor(() => expect((enabled as HTMLButtonElement).disabled).toBe(false));
  });
});

// Citation sample kept for shape reference in future tests.
export const _sampleCitation: Citation = {
  row_id: '10492',
  field: 'dst_port',
  value: '8443',
  expected: null,
  status: 'VERIFIED',
  reason: 'ok',
  agent_id: 'network_traffic',
  round: 1,
  row_fingerprint: 'f'.repeat(64),
};
