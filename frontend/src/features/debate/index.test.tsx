import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Citation,
  DebateRound,
  EvidenceBundleResponse,
  FleetEntry,
  InvestigationCitations,
  InvestigationDetail,
  InvestigatorId,
  LiveFrame,
  Me,
  RoundAgentTurn,
  Vote,
} from '../../api/types';
import type { InvestigationSocketHandlers } from '../../api/socket';
import { evidenceOutsideMono } from '../../test/evidence';

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
  usePollWhile: vi.fn(),
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
// The polling fallback is a hook of its own (use-poll-while.test.ts); here only what the room passes to it is checked.
vi.mock('../../app/use-poll-while', () => ({ usePollWhile: h.usePollWhile }));

const lastPoll = () => h.usePollWhile.mock.calls.at(-1) as [boolean, number, () => void];

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
  provider_chain: ['openai'],
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
    openai: { configured: true, model: 'gpt-4.1-mini', temperature: metric(0.2), calls_24h: metric(3), latency_ms: metric(null), quota_errors_24h: metric(0) },
  },
  sandbox: { is_simulated_violations: metric(0), actions_total: metric(0) },
  debate_slot: { status: 'idle', investigation_id: null, running: metric(0), capacity: metric(4), investigation_ids: [] },
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
  provider: 'openai',
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
    citations: { total: 0, verified: 0, discrepancy: 0, invalid_row: 0, items: [] },
  },
  bundle_sha256: 'a'.repeat(64),
  signatures: [],
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
    data_source: 'model',
    error_reason: null,
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
    h.getInvestigation.mockResolvedValue(detail({ status: 'investigating', verdict_class: null, verdict_confidence: null }));
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

  it('survives the real verdict frame (verdict is the engine dict) when a debate finishes while the page is open', async () => {
    h.getInvestigation.mockResolvedValueOnce(detail({ status: 'investigating', verdict_class: null, verdict_confidence: null }));
    // The reload that follows a verdict frame stays pending, so what is on screen comes from the frame itself.
    h.getInvestigation.mockReturnValue(new Promise(() => undefined));
    render(<DebatePage id="inv-1" />);

    await waitFor(() => expect(h.connectInvestigationSocket).toHaveBeenCalledTimes(1));
    const handlers = h.connectInvestigationSocket.mock.calls[0][2] as InvestigationSocketHandlers;
    const frame = {
      type: 'verdict',
      investigation_id: 'inv-1',
      verdict: {
        verdict_class: 'botnet_c2',
        verdict_confidence: 0.82,
        status: 'verdict_reached',
        supporting_evidence: [{ row_id: 'r1', field: 'dst_port', value: '8443' }],
        contributing_agents: ['network_traffic', 'access_log'],
      },
      status: 'contained',
      actions_taken: [{ action_type: 'block_ip_range', target: '10.0.0.0/24', reason: 'sandbox response' }],
    } as unknown as LiveFrame;
    await act(async () => {
      handlers.onFrame(frame);
    });

    expect((await screen.findAllByText('Botnet C2')).length).toBeGreaterThan(0);
    expect(screen.getByText('botnet_c2')).toBeTruthy();
    expect(screen.queryByText('[object Object]')).toBeNull();
  });

  it('says why a debate stopped when it ended in error, instead of showing it as still in progress', async () => {
    h.getInvestigation.mockResolvedValue(
      detail({
        status: 'error',
        verdict_class: null,
        verdict_confidence: null,
        error_reason: 'The openai account has no quota or credit left. Add credit in the OpenAI account, then try again.',
        rounds: [{ round: 1, agents: [turn('network_traffic', { theory: 'a round that did finish' })] }] satisfies DebateRound[],
      }),
    );
    render(<DebatePage id="inv-1" />);

    expect(await screen.findByText('This debate stopped before a verdict')).toBeTruthy();
    expect(screen.getByTestId('failure-reason').textContent).toMatch(/no quota or credit left/);
    expect(screen.getAllByText('Debate stopped').length).toBeGreaterThan(0);
    expect(screen.queryByText('Adjudication in progress')).toBeNull();
    expect((await screen.findAllByText('a round that did finish')).length).toBeGreaterThan(0); // the finished round stays
    expect(h.connectInvestigationSocket).not.toHaveBeenCalled();
  });

  it('shows a stopped debate as stopped everywhere: the cut-off round, the verdict and the containment gate', async () => {
    h.getInvestigation.mockResolvedValue(
      detail({
        status: 'error',
        verdict_class: null,
        verdict_confidence: null,
        error_reason: 'An investigator returned an answer that failed validation.',
        rounds: [
          { round: 1, agents: [turn('network_traffic'), turn('access_log'), turn('endpoint_behavior')] },
          { round: 2, agents: [turn('network_traffic'), turn('access_log'), turn('endpoint_behavior')] },
          { round: 3, agents: [turn('network_traffic'), turn('access_log')] },
        ] satisfies DebateRound[],
        // The API lists each agent's latest answer, classified, even though no vote was ever taken.
        votes: [
          { agent_id: 'network_traffic', verdict_class: 'botnet_c2', confidence: 0.56, matched_keywords: ['c2'] },
          { agent_id: 'access_log', verdict_class: 'insider_file_exfiltration', confidence: 0.55, matched_keywords: ['exfil'] },
        ] satisfies Vote[],
      }),
    );
    render(<DebatePage id="inv-1" />);

    expect(await screen.findByText('Round 3 : stopped · 2 of 3 answered')).toBeTruthy();
    expect(screen.getByText('Round 1 : complete')).toBeTruthy();
    expect(screen.getByText('No verdict: the debate stopped')).toBeTruthy();
    expect(screen.queryByText('No verdict yet')).toBeNull();
    expect(screen.getByText('no quorum: the debate stopped')).toBeTruthy();
    expect(screen.queryByText(/primary agent decided/)).toBeNull();
    expect(screen.getByText('Latest answers, classified (no vote was taken)')).toBeTruthy();
    expect(screen.queryByText('Final synthesised verdict')).toBeNull();
    const gate = within(screen.getByRole('region', { name: 'Containment gate' }));
    expect(gate.getByText('no verdict: the debate stopped')).toBeTruthy();
    expect(gate.queryByText('waiting for a verdict')).toBeNull();
  });

  it('explains why a case was not contained, with the confidence and the floor it was judged against', async () => {
    const votes: Vote[] = [
      { agent_id: 'network_traffic', verdict_class: 'botnet_c2', confidence: 0.7, matched_keywords: ['c2'] },
      { agent_id: 'access_log', verdict_class: 'botnet_c2', confidence: 0.7, matched_keywords: ['beacon'] },
    ];
    h.getInvestigation.mockResolvedValue(detail({ status: 'verdict_reached', verdict_class: 'botnet_c2', verdict_confidence: 0.7, votes, actions: [] }));
    render(<DebatePage id="inv-1" />);

    const gate = within(await screen.findByRole('region', { name: 'Containment gate' }));
    expect(gate.getByText('refused: nothing was contained')).toBeTruthy();
    expect(gate.getAllByText('Confidence 70.0% is below the floor 80.0%.').length).toBeGreaterThan(0);
    expect(gate.getByText('Botnet C2 plans sandbox actions.')).toBeTruthy();
  });

  it('shows the gate as passed for a contained case', async () => {
    const votes: Vote[] = [
      { agent_id: 'network_traffic', verdict_class: 'botnet_c2', confidence: 0.9, matched_keywords: ['c2'] },
      { agent_id: 'access_log', verdict_class: 'botnet_c2', confidence: 0.9, matched_keywords: ['beacon'] },
    ];
    const credibility = (agent: 'network_traffic' | 'access_log') => ({
      investigation_id: 'inv-1',
      round: 3,
      agent_id: agent,
      crs_before: 0.5,
      crs_after: 0.62,
      verification_match_rate: 1,
      isolated: false,
      created_at: '2026-10-05T00:00:00Z',
    });
    h.getInvestigation.mockResolvedValue(
      detail({
        status: 'contained',
        verdict_class: 'botnet_c2',
        verdict_confidence: 0.9,
        votes,
        credibility: [credibility('network_traffic'), credibility('access_log')],
        actions: [{ id: 'a1', investigation_id: 'inv-1', action_type: 'block_ip_range', target: '10.0.0.5', reason: 'r', is_simulated: true, created_at: '2026-10-05T00:00:00Z' }],
      }),
    );
    render(<DebatePage id="inv-1" />);

    const gate = within(await screen.findByRole('region', { name: 'Containment gate' }));
    expect(gate.getByText('passed: the sandbox actions ran')).toBeTruthy();
    expect(gate.getAllByText(/· Passed/)).toHaveLength(4);
  });

  it('shows every id and hash in the evidence font', async () => {
    const id = 'e4c7c25e-02ff-44f4-aac1-530598a934cd';
    h.getInvestigation.mockResolvedValue(
      detail({ id, rounds: [{ round: 1, agents: [turn('network_traffic', { theory: 'a theory' })] }] satisfies DebateRound[] }),
    );
    h.getInvestigationCitations.mockResolvedValue({
      summary: { total: 1, verified: 1, discrepancy: 0, invalid_row: 0, match_rate: metric(1) },
      citations: [
        { row_id: '574a5ec4-b50a-4be0-bb55-d96a032d8f92', field: 'Destination Port', value: '443', expected: '443', status: 'VERIFIED', reason: 'ok', agent_id: 'network_traffic', round: 1, row_fingerprint: 'd'.repeat(64) },
      ],
    });
    h.getEvidenceBundle.mockResolvedValue({ ...bundle, bundle_sha256: 'c'.repeat(64) });
    const { container } = render(<DebatePage id={id} />);

    await screen.findByText('#574a5ec4-b50a-4be0-bb55-d96a032d8f92');
    await screen.findByRole('button', { name: 'Copy Evidence bundle SHA-256' });

    expect(evidenceOutsideMono(container)).toEqual([]);
  });

  it('does not invent a cause for a case that failed before reasons were stored', async () => {
    h.getInvestigation.mockResolvedValue(detail({ status: 'error', verdict_class: null, verdict_confidence: null, error_reason: null }));
    render(<DebatePage id="inv-1" />);

    expect((await screen.findByTestId('failure-reason')).textContent).toMatch(/No reason was recorded/);
  });

  it('turns a live error frame into the banner and reloads the stored case', async () => {
    h.getInvestigation.mockResolvedValueOnce(detail({ status: 'investigating', verdict_class: null, verdict_confidence: null }));
    h.getInvestigation.mockResolvedValue(
      detail({ status: 'error', verdict_class: null, verdict_confidence: null, error_reason: 'An investigator returned an answer that failed validation.' }),
    );
    render(<DebatePage id="inv-1" />);

    await waitFor(() => expect(h.connectInvestigationSocket).toHaveBeenCalledTimes(1));
    const handlers = h.connectInvestigationSocket.mock.calls[0][2] as InvestigationSocketHandlers;
    await act(async () => {
      handlers.onFrame({ type: 'error', investigation_id: 'inv-1', detail: 'An investigator returned an answer that failed validation.' } as LiveFrame);
    });

    expect((await screen.findByTestId('failure-reason')).textContent).toMatch(/failed validation/);
    await waitFor(() => expect(h.getInvestigation).toHaveBeenCalledTimes(2)); // the stored case was read again
  });

  it('reads a running case again every few seconds while the live socket is not open', async () => {
    h.getInvestigation.mockResolvedValue(detail({ status: 'investigating', verdict_class: null, verdict_confidence: null }));
    render(<DebatePage id="inv-1" />);
    await waitFor(() => expect(h.connectInvestigationSocket).toHaveBeenCalledTimes(1)); // asked for, not open yet

    const [active, intervalMs, tick] = lastPoll();
    expect(active).toBe(true);
    expect(intervalMs).toBe(4000);
    const reads = h.getInvestigation.mock.calls.length;
    await act(async () => tick());
    await waitFor(() => expect(h.getInvestigation.mock.calls.length).toBeGreaterThan(reads)); // the stored case was read again
  });

  it('stops polling once the socket is open', async () => {
    h.getInvestigation.mockResolvedValue(detail({ status: 'investigating', verdict_class: null, verdict_confidence: null }));
    render(<DebatePage id="inv-1" />);
    await waitFor(() => expect(h.connectInvestigationSocket).toHaveBeenCalledTimes(1));
    const handlers = h.connectInvestigationSocket.mock.calls[0][2] as InvestigationSocketHandlers;

    await act(async () => handlers.onStatus?.({ state: 'open', attempt: 0 }));

    expect(lastPoll()[0]).toBe(false);
  });

  it('keeps polling when the socket ticket is refused, so a running debate never freezes on screen', async () => {
    h.getWsTicket.mockRejectedValue(new Error('no ticket'));
    h.getInvestigation.mockResolvedValue(detail({ status: 'investigating', verdict_class: null, verdict_confidence: null }));
    render(<DebatePage id="inv-1" />);

    await waitFor(() => expect(h.getWsTicket).toHaveBeenCalled());
    expect(h.connectInvestigationSocket).not.toHaveBeenCalled(); // there is no socket at all
    expect(lastPoll()[0]).toBe(true);
    expect(screen.queryByText('This debate stopped before a verdict')).toBeNull(); // and it is not shown as stopped
  });

  it('does not poll a finished case', async () => {
    h.getInvestigation.mockResolvedValue(detail());
    render(<DebatePage id="inv-1" />);
    await screen.findAllByText('Botnet C2');

    expect(lastPoll()[0]).toBe(false);
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

  it('shows an isolated agent vote as not counted and keeps it out of the recomputed confidence', async () => {
    const votes: Vote[] = [
      { agent_id: 'network_traffic', verdict_class: 'botnet_c2', confidence: 0.8, matched_keywords: ['c2'] },
      { agent_id: 'access_log', verdict_class: 'botnet_c2', confidence: 0.2, matched_keywords: ['beacon'], counted: false },
    ];
    h.getInvestigation.mockResolvedValue(detail({ verdict_confidence: 0.8, votes }));
    render(<DebatePage id="inv-1" />);

    expect(await screen.findByText(/not counted · isolated/i)).toBeTruthy();
    // 0.8 only: the isolated agent's 0.2 would have pulled the mean down to 0.5 and shown a mismatch.
    expect(await screen.findByText(/recompute matches server/i)).toBeTruthy();
  });

  it('says whether each vote class was stated by the agent or read from its text', async () => {
    const votes: Vote[] = [
      { agent_id: 'network_traffic', verdict_class: 'botnet_c2', confidence: 0.8, class_source: 'stated', matched_keywords: [] },
      { agent_id: 'access_log', verdict_class: 'botnet_c2', confidence: 0.8, class_source: 'keywords', matched_keywords: ['beacon'] },
    ];
    h.getInvestigation.mockResolvedValue(detail({ verdict_confidence: 0.8, votes }));
    render(<DebatePage id="inv-1" />);

    expect(await screen.findByText('stated')).toBeTruthy();
    expect(screen.getByText('read from text')).toBeTruthy();
  });

  it('says a quarantined agent did not take part, with no confidence or credibility-arrow noise', async () => {
    h.getAgentFleet.mockResolvedValue([
      FLEET[0],
      FLEET[1],
      { ...fleetEntry('endpoint_behavior', 'Endpoint-Behavior'), isolated: true },
    ]);
    h.getInvestigation.mockResolvedValue(
      detail({ rounds: [{ round: 1, agents: [turn('network_traffic'), turn('access_log')] }] satisfies DebateRound[] }),
    );
    render(<DebatePage id="inv-1" />);

    expect(await screen.findByText('Quarantined: did not take part in this debate')).toBeTruthy();
    expect(screen.queryByText('No theory recorded for this agent yet.')).toBeNull();
    // Only the two agents that spoke keep their confidence row and CrS arrow.
    expect(screen.getAllByText('Confidence trajectory')).toHaveLength(2);
    expect(screen.getAllByText(/Credibility \(CrS\) .* →/)).toHaveLength(2);
  });

  it('shows how the data slice of each agent was chosen, in plain words', async () => {
    h.getInvestigation.mockResolvedValue(
      detail({
        rounds: [{ round: 1, agents: [turn('network_traffic'), turn('access_log'), turn('endpoint_behavior')] }] satisfies DebateRound[],
        input_basis: {
          network_traffic: { basis: 'scenario_rows', row_count: 5 },
          access_log: { basis: 'recent_sample', row_count: 1 },
          endpoint_behavior: { basis: 'same_user_window', row_count: 2 },
        },
      }),
    );
    render(<DebatePage id="inv-1" />);

    expect(await screen.findByText('scenario rows')).toBeTruthy();
    expect(screen.getByText('recent sample')).toBeTruthy();
    expect(screen.getByText('same user · time window')).toBeTruthy();
    expect(screen.getByText(/· 1 row$/)).toBeTruthy(); // singular for a single row
  });

  it('shows no data-slice line for an investigation that predates the record', async () => {
    h.getInvestigation.mockResolvedValue(
      detail({ rounds: [{ round: 1, agents: [turn('network_traffic')] }] satisfies DebateRound[] }),
    );
    render(<DebatePage id="inv-1" />);

    await screen.findAllByText('Confidence trajectory');
    expect(screen.queryByText(/Data slice:/)).toBeNull();
  });

  it('keeps "No theory recorded yet" for a running debate whose agent has not spoken', async () => {
    h.getInvestigation.mockResolvedValue(
      detail({
        status: 'investigating',
        verdict_class: null,
        verdict_confidence: null,
        rounds: [{ round: 1, agents: [turn('network_traffic')] }] satisfies DebateRound[],
      }),
    );
    render(<DebatePage id="inv-1" />);

    expect((await screen.findAllByText('No theory recorded for this agent yet.')).length).toBe(2);
    expect(screen.queryByText(/did not take part/)).toBeNull();
  });

  it('states only the fact when a finished debate has no turns for an agent that is not quarantined now', async () => {
    h.getInvestigation.mockResolvedValue(
      detail({ rounds: [{ round: 1, agents: [turn('network_traffic'), turn('access_log')] }] satisfies DebateRound[] }),
    );
    render(<DebatePage id="inv-1" />);

    expect(await screen.findByText(/Did not take part in this debate: no transcript turns/)).toBeTruthy();
    expect(screen.queryByText(/Quarantined: did not take part/)).toBeNull();
  });

  it('shows a dismissible how-to-read hint and a copy button on the shortened case id', async () => {
    h.getInvestigation.mockResolvedValue(detail());
    render(<DebatePage id="inv-12345678-xyz" />);
    expect(screen.getByText('How to read this page')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss how-to-read hint' }));
    expect(screen.queryByText('How to read this page')).toBeNull();
    expect(window.localStorage.getItem('vc-hint-dismissed:debate-room')).toBe('1');
    expect(await screen.findByText('inv-1234')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy investigation id' })).toBeTruthy();
  });

  it('shows the earliest verified cited time as written, in absolute form', async () => {
    h.getInvestigation.mockResolvedValue(detail());
    h.getInvestigationCitations.mockResolvedValue({
      summary: emptyCitations.summary,
      citations: [{ ...(_sampleCitation as Citation), field: 'timestamp', value: '2010-09-23 08:14:00', status: 'VERIFIED' }],
    });
    const { container } = render(<DebatePage id="inv-1" />);
    await waitFor(() => expect(container.querySelector('time[datetime="2010-09-23 08:14:00"]')?.textContent).toBe('2010-09-23 08:14:00'));
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
