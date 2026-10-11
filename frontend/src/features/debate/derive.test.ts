import { describe, expect, it } from 'vitest';
import type { DebateRound, InvestigationDetail, LiveFrame, RoundAgentTurn } from '../../api/types';
import { quorumFromVotes } from '../../lib/derive/verdict';
import { applyFrame, emptyDebate, fromDetail, laneAbsence, laneFor, mostCitedValue, quorumPill, roundSteps, stanceLabel, stanceTone } from './derive';

const turn = (agentId: RoundAgentTurn['agent_id'], over: Partial<RoundAgentTurn> = {}): RoundAgentTurn => ({
  agent_id: agentId,
  theory: 'theory',
  confidence: 0.5,
  stance: null,
  provider: 'openai',
  cited_evidence: [],
  credibility: 0.5,
  ...over,
});

const round = (n: number, agents: RoundAgentTurn[]): DebateRound => ({ round: n, agents });

describe('a debate that ends in error', () => {
  it('an error frame marks the case as stopped and keeps the reason the engine gave', () => {
    const running = { ...emptyDebate(), status: 'investigating' as const };
    const next = applyFrame(running, { type: 'error', investigation_id: 'i', detail: 'The openai account has no credit left.' } as LiveFrame);

    expect(next.status).toBe('error');
    expect(next.errorReason).toBe('The openai account has no credit left.');
  });

  it('the stored reason comes from the investigation detail, and is null for a case that did not fail', () => {
    const base = { rounds: [], citations: { total: 0, verified: 0, discrepancy: 0, invalid_row: 0, match_rate: {} }, credibility: [], actions: [], votes: [] };
    const failed = fromDetail({ ...base, id: 'i', status: 'error', error_reason: 'cut off' } as unknown as InvestigationDetail);
    const fine = fromDetail({ ...base, id: 'i', status: 'contained', error_reason: null } as unknown as InvestigationDetail);

    expect(failed.errorReason).toBe('cut off');
    expect(fine.errorReason).toBeNull();
    expect(emptyDebate().errorReason).toBeNull();
  });
});

describe('applyFrame', () => {
  it('upserts a round from a round_completed frame', () => {
    const frame: LiveFrame = {
      type: 'round_completed',
      investigation_id: 'i',
      round: 1,
      agents: [turn('network_traffic', { theory: 'alpha theory' })],
    };
    const next = applyFrame(emptyDebate(), frame);
    expect(next.rounds).toHaveLength(1);
    expect(next.rounds[0].agents[0].theory).toBe('alpha theory');
  });

  it('replaces the same round rather than duplicating it, keeping rounds sorted', () => {
    let state = applyFrame(emptyDebate(), { type: 'round_completed', investigation_id: 'i', round: 2, agents: [turn('access_log')] });
    state = applyFrame(state, { type: 'round_completed', investigation_id: 'i', round: 1, agents: [turn('network_traffic')] });
    state = applyFrame(state, { type: 'round_completed', investigation_id: 'i', round: 1, agents: [turn('network_traffic'), turn('access_log')] });
    expect(state.rounds.map((r) => r.round)).toEqual([1, 2]);
    expect(state.rounds[0].agents).toHaveLength(2);
  });

  // The agent entry exactly as the engine sends it: credibility is the score dict of the round, not a number.
  const engineAgent = (agentId: RoundAgentTurn['agent_id'], crsBefore: number, crsAfter: number) => ({
    agent_id: agentId,
    theory: 'SUPPORT: the same flood',
    confidence: 0.8,
    stance: 'SUPPORT',
    provider: 'stub-openai',
    cited_evidence: [],
    credibility: { agent_id: agentId, crs_before: crsBefore, crs_after: crsAfter, verification_match_rate: 1, isolated: false },
  });

  it('turns the score dict of a round_completed frame into a number and a credibility row', () => {
    const frame = {
      type: 'round_completed',
      investigation_id: 'inv-1',
      round: 1,
      agents: [engineAgent('network_traffic', 0.5, 0.6), engineAgent('access_log', 0.5, 0.4)],
    } as unknown as LiveFrame;
    const next = applyFrame(emptyDebate(), frame);

    expect(next.rounds[0].agents.map((agent) => agent.credibility)).toEqual([0.6, 0.4]); // numbers, never objects
    expect(next.rounds[0].agents[0].stance).toBe('SUPPORT');
    expect(next.credibility.map((row) => [row.agent_id, row.round, row.crs_after, row.investigation_id])).toEqual([
      ['network_traffic', 1, 0.6, 'inv-1'],
      ['access_log', 1, 0.4, 'inv-1'],
    ]);
  });

  // The snapshot exactly as backend/api/websocket.py builds it: no stance, no turn credibility, no action id.
  const snapshot = {
    type: 'snapshot',
    investigation_id: 'inv-1',
    status: 'investigating',
    rounds: [
      {
        round: 1,
        agents: [
          { agent_id: 'network_traffic', theory: 'flood', confidence: 0.8, provider: 'stub-openai', cited_evidence: [] },
          { agent_id: 'access_log', theory: 'exfil', confidence: 0.7, provider: 'stub-openai', cited_evidence: [] },
        ],
      },
    ],
    credibility: [
      { agent_id: 'network_traffic', round: 1, crs_before: 0.5, crs_after: 0.6, verification_match_rate: 1, isolated: false },
      { agent_id: 'access_log', round: 1, crs_before: 0.5, crs_after: 0.4, verification_match_rate: 0, isolated: false },
    ],
    actions: [
      { action_type: 'trigger_audit', target: 'a', reason: 'r', is_simulated: true },
      { action_type: 'trigger_audit', target: 'a', reason: 'r', is_simulated: true },
    ],
    verdict: null,
  } as unknown as LiveFrame;

  it('a snapshot fills a state that has nothing yet, with the CrS from its own credibility rows', () => {
    const next = applyFrame(emptyDebate(), snapshot);
    expect(next.rounds[0].agents.map((agent) => [agent.agent_id, agent.credibility, agent.stance])).toEqual([
      ['network_traffic', 0.6, null], // the snapshot carries no stance: it stays "not stated", never parsed from text
      ['access_log', 0.4, null],
    ]);
    expect(next.credibility).toHaveLength(2);
  });

  it('a snapshot never replaces turns the page already holds from the REST detail', () => {
    const loaded = {
      ...emptyDebate(),
      rounds: [round(1, [turn('network_traffic', { stance: 'CHALLENGE', credibility: 0.61 })])],
    };
    const next = applyFrame(loaded, snapshot);
    const kept = next.rounds[0].agents.find((agent) => agent.agent_id === 'network_traffic');
    expect(kept?.stance).toBe('CHALLENGE');
    expect(kept?.credibility).toBe(0.61);
    expect(next.rounds[0].agents).toHaveLength(2); // the missing agent was added
  });

  it('snapshot actions get unique keys (rows without an id used to trigger the React key warning)', () => {
    const next = applyFrame(emptyDebate(), snapshot);
    const ids = next.actions.map((action) => action.id);
    expect(new Set(ids).size).toBe(2);
    expect(next.actions.every((action) => action.investigation_id === 'inv-1' && action.is_simulated)).toBe(true);
  });

  // The frame exactly as backend/debate/engine.py sends it: verdict is the engine's dict, not a class string.
  const realVerdictFrame = (verdict: unknown, status = 'verdict_reached') =>
    ({
      type: 'verdict',
      investigation_id: 'i',
      verdict,
      status,
      actions_taken: [{ action_type: 'block_ip_range', target: '10.0.0.0/24', reason: 'sandbox' }],
    }) as unknown as LiveFrame;

  const ENGINE_VERDICT = {
    verdict_class: 'botnet_c2',
    verdict_confidence: 0.82,
    status: 'verdict_reached',
    supporting_evidence: [{ row_id: 'r1', field: 'dst_port', value: '8443' }],
    contributing_agents: ['network_traffic', 'access_log'],
  };

  it('reads the class and confidence from the verdict object of a real verdict frame', () => {
    const next = applyFrame(emptyDebate(), realVerdictFrame(ENGINE_VERDICT, 'contained'));
    expect(next.verdictClass).toBe('botnet_c2');
    expect(next.verdictConfidence).toBe(0.82);
    expect(next.status).toBe('contained');
    expect(typeof next.verdictClass).toBe('string');
  });

  it('never stores an object or a bare string as the verdict class', () => {
    const start = { ...emptyDebate(), verdictClass: 'ddos' as const, verdictConfidence: 0.7 };
    for (const odd of ['botnet_c2', { verdict_class: { nested: true } }, { verdict_class: 'not_a_class' }, null, 42]) {
      const next = applyFrame(start, realVerdictFrame(odd));
      expect(next.verdictClass).toBe('ddos');
      expect(next.verdictConfidence).toBe(0.7);
    }
  });

  it('keeps the actions already shown, because the frame rows have no id or simulation flag', () => {
    const next = applyFrame(emptyDebate(), realVerdictFrame(ENGINE_VERDICT));
    expect(next.actions).toEqual([]);
  });
});

describe('roundSteps', () => {
  it('marks a finished debate with all rounds complete', () => {
    const rounds = [round(1, [turn('network_traffic')]), round(2, [turn('network_traffic')]), round(3, [turn('network_traffic')])];
    const steps = roundSteps(rounds, 3, 'verdict_reached', 3);
    expect(steps.map((s) => s.state)).toEqual(['complete', 'complete', 'complete']);
  });

  it('marks the next round active while running', () => {
    const rounds = [round(1, [turn('network_traffic'), turn('access_log'), turn('endpoint_behavior')])];
    const steps = roundSteps(rounds, 3, 'investigating', 3);
    expect(steps[0].state).toBe('complete');
    expect(steps[1].state).toBe('active');
    expect(steps[2].state).toBe('pending');
  });

  describe('when the debate ended in error', () => {
    const all = [turn('network_traffic'), turn('access_log'), turn('endpoint_behavior')];

    it('marks the round that was cut off as stopped and says how many agents had answered', () => {
      const rounds = [round(1, all), round(2, all), round(3, [turn('network_traffic'), turn('access_log')])];
      const steps = roundSteps(rounds, 3, 'error', 3);

      expect(steps.map((s) => s.state)).toEqual(['complete', 'complete', 'stopped']);
      expect(steps[2]).toMatchObject({ answered: 2, expected: 3 });
    });

    it('marks the round that never started as stopped when the error came between two rounds', () => {
      const steps = roundSteps([round(1, all)], 3, 'error', 3);

      expect(steps.map((s) => s.state)).toEqual(['complete', 'stopped', 'pending']);
      expect(steps[1]).toMatchObject({ answered: 0, expected: 3 });
    });

    it('marks round 1 as stopped when the very first call failed, and never activates a later round', () => {
      const steps = roundSteps([], 3, 'error', 3);

      expect(steps.map((s) => s.state)).toEqual(['stopped', 'pending', 'pending']);
    });

    it('leaves every round complete when all of them finished, because nothing was cut off', () => {
      const steps = roundSteps([round(1, all), round(2, all), round(3, all)], 3, 'error', 3);

      expect(steps.map((s) => s.state)).toEqual(['complete', 'complete', 'complete']);
    });
  });
});

describe('quorumPill', () => {
  const vote = (agent_id: string, verdict_class: string | null) => ({ agent_id, verdict_class, confidence: 0.6 });
  const split = quorumFromVotes([vote('network_traffic', 'ddos'), vote('access_log', 'brute_force')], 'network_traffic');
  const agreed = quorumFromVotes([vote('network_traffic', 'ddos'), vote('access_log', 'ddos'), vote('endpoint_behavior', null)]);

  it('shows the quorum the votes make, with a tone that matches it', () => {
    expect(quorumPill('verdict_reached', agreed)).toEqual({ label: '2/3 agree', tone: 'secondary' });
    expect(quorumPill('verdict_reached', split)).toEqual({ label: 'no majority: primary agent decided', tone: 'secondary' });
    expect(quorumPill('investigating', quorumFromVotes([]))).toEqual({ label: 'no votes yet', tone: 'neutral' });
    expect(quorumPill('ambiguous', quorumFromVotes([vote('network_traffic', 'ddos'), vote('access_log', 'brute_force')]))).toMatchObject({ tone: 'tertiary' });
  });

  it('never claims a quorum for a debate that stopped, even though the API lists classified answers for it', () => {
    for (const quorum of [agreed, split, quorumFromVotes([])]) {
      expect(quorumPill('error', quorum)).toEqual({ label: 'no quorum: the debate stopped', tone: 'error' });
    }
  });
});

describe('laneFor', () => {
  it('reports first and latest confidence for an agent across rounds', () => {
    const rounds = [
      round(1, [turn('network_traffic', { confidence: 0.4 })]),
      round(2, [turn('network_traffic', { confidence: 0.9, stance: 'SUPPORT' })]),
    ];
    const lane = laneFor(rounds, 'network_traffic');
    expect(lane.firstConfidence).toBe(0.4);
    expect(lane.latestConfidence).toBe(0.9);
    expect(lane.latest?.stance).toBe('SUPPORT');
  });
});

describe('stance helpers', () => {
  it('labels a missing stance honestly', () => {
    expect(stanceLabel(null)).toBe('stance not stated');
    expect(stanceLabel('SUPPORT')).toBe('SUPPORT');
  });
  it('maps stance to a tone', () => {
    expect(stanceTone('SUPPORT')).toBe('secondary');
    expect(stanceTone('CHALLENGE')).toBe('tertiary');
    expect(stanceTone(null)).toBe('neutral');
  });
});

describe('fromDetail', () => {
  it('seeds the live state from an investigation detail', () => {
    const detail = {
      id: 'i',
      status: 'investigating',
      verdict_class: null,
      verdict_confidence: null,
      primary_agent: 'network_traffic',
      dataset: 'CICIDS2017',
      noise_pct: 0,
      effective_noise_pct: 0,
      trigger_type: 'simulate',
      trigger_reason: null,
      rounds: [round(2, [turn('network_traffic')]), round(1, [turn('access_log')])],
      citations: { total: 0, verified: 0, discrepancy: 0, invalid_row: 0, match_rate: { value: null, n: 0, as_of: 'x', source: 's', definition: 'd', reason: 'none' } },
      credibility: [],
      actions: [],
      votes: [],
      created_at: '2026-10-05T00:00:00Z',
    } as unknown as InvestigationDetail;
    const state = fromDetail(detail);
    expect(state.rounds.map((r) => r.round)).toEqual([1, 2]);
    expect(state.status).toBe('investigating');
  });
});

describe('mostCitedValue (debate)', () => {
  const cited = (value: string, status = 'VERIFIED') => ({ field: 'user_id', value, status });

  it('breaks a 3-3 tie with the lexicographically smallest value, in either arrival order', () => {
    const nine = [cited('u-9'), cited('u-9'), cited('u-9')];
    const two = [cited('u-2'), cited('u-2'), cited('u-2')];
    expect(mostCitedValue([...nine, ...two], 'user_id')).toBe('u-2');
    expect(mostCitedValue([...two, ...nine], 'user_id')).toBe('u-2');
  });

  it('counts only VERIFIED values', () => {
    expect(mostCitedValue([cited('fake', 'DISCREPANCY'), cited('fake', 'DISCREPANCY'), cited('real')], 'user_id')).toBe('real');
    expect(mostCitedValue([cited('fake', 'INVALID_ROW')], 'user_id')).toBeNull();
  });
});

describe('laneAbsence', () => {
  const spoke = laneFor([round(1, [turn('network_traffic')])], 'network_traffic');
  const silent = laneFor([round(1, [turn('network_traffic')])], 'access_log');

  it('is null for an agent that took part, even if it is quarantined now', () => {
    expect(laneAbsence(spoke, false, 'verdict_reached')).toBeNull();
    expect(laneAbsence(spoke, true, 'verdict_reached')).toBeNull();
  });

  it('says quarantined for a silent agent the fleet reports isolated, running or finished', () => {
    expect(laneAbsence(silent, true, 'verdict_reached')).toBe('quarantined');
    expect(laneAbsence(silent, true, 'investigating')).toBe('quarantined');
  });

  it('states only the fact for a silent, non-quarantined agent in a finished debate', () => {
    expect(laneAbsence(silent, false, 'contained')).toBe('no_turns');
    expect(laneAbsence(silent, false, 'ambiguous')).toBe('no_turns');
  });

  it('keeps the "not spoken yet" wording while the debate runs or the status is unknown', () => {
    expect(laneAbsence(silent, false, 'investigating')).toBeNull();
    expect(laneAbsence(silent, false, null)).toBeNull();
  });
});
