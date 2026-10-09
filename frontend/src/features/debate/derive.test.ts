import { describe, expect, it } from 'vitest';
import type { DebateRound, InvestigationDetail, LiveFrame, RoundAgentTurn } from '../../api/types';
import { applyFrame, emptyDebate, fromDetail, laneFor, roundSteps, stanceLabel, stanceTone } from './derive';

const turn = (agentId: RoundAgentTurn['agent_id'], over: Partial<RoundAgentTurn> = {}): RoundAgentTurn => ({
  agent_id: agentId,
  theory: 'theory',
  confidence: 0.5,
  stance: null,
  provider: 'groq',
  cited_evidence: [],
  credibility: 0.5,
  ...over,
});

const round = (n: number, agents: RoundAgentTurn[]): DebateRound => ({ round: n, agents });

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

  it('sets the verdict and status from a verdict frame', () => {
    const next = applyFrame(emptyDebate(), { type: 'verdict', investigation_id: 'i', verdict: 'botnet_c2', status: 'verdict_reached', actions_taken: [] });
    expect(next.verdictClass).toBe('botnet_c2');
    expect(next.status).toBe('verdict_reached');
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
