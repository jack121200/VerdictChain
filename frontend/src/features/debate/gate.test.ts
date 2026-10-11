import { describe, expect, it } from 'vitest';
import type { CredibilityRow, ResponseAction, Vote } from '../../api/types';
import { containmentGate, type GateInput } from './gate';

const NAMES = { network_traffic: 'Network-Traffic', access_log: 'Access-Log', endpoint_behavior: 'Endpoint-Behavior' } as const;

const vote = (agent: Vote['agent_id'], verdictClass: string | null, over: Partial<Vote> = {}): Vote =>
  ({ agent_id: agent, verdict_class: verdictClass, confidence: 0.9, matched_keywords: [], counted: true, ...over }) as Vote;

const crs = (agent: CredibilityRow['agent_id'], round: number, after: number): CredibilityRow => ({
  investigation_id: 'i',
  round,
  agent_id: agent,
  crs_before: 0.5,
  crs_after: after,
  verification_match_rate: 1,
  isolated: false,
  created_at: '2026-10-11T00:00:00Z',
});

const ACTION = { id: 'a', investigation_id: 'i', action_type: 'block_ip_range', target: '10.0.0.5', reason: 'r', is_simulated: true, created_at: '' } as ResponseAction;

/** A case that passes all four checks; each test breaks one thing. */
function input(over: Partial<GateInput> = {}): GateInput {
  return {
    status: 'verdict_reached',
    verdictClass: 'ddos',
    verdictConfidence: 0.9,
    floor: 0.8,
    credibilityFloor: 0.5,
    votes: [vote('network_traffic', 'ddos'), vote('access_log', 'ddos'), vote('endpoint_behavior', 'benign')],
    credibility: [crs('network_traffic', 1, 0.52), crs('network_traffic', 3, 0.64), crs('access_log', 3, 0.58), crs('endpoint_behavior', 3, 0.2)],
    actions: [],
    agentName: (id) => NAMES[id],
    ...over,
  };
}

const states = (gate: ReturnType<typeof containmentGate>) => gate.checks.map((check) => check.state);

describe('containmentGate', () => {
  it('passes when the verdict, the class, the confidence and every supporter clear their bar', () => {
    const gate = containmentGate(input({ status: 'contained', actions: [ACTION] }));

    expect(states(gate)).toEqual(['pass', 'pass', 'pass', 'pass']);
    expect(gate.outcome).toBe('passed');
    expect(gate.refusal).toBeNull();
  });

  it('judges a supporter on its credibility after its LAST round, and leaves out an agent that voted another class', () => {
    // endpoint_behavior sits at 0.20, but it voted benign: it does not support ddos, so it cannot hold the gate shut.
    // network_traffic had 0.52 in round 1 and 0.64 in round 3: the last one counts.
    const gate = containmentGate(input());

    expect(gate.checks[3]).toMatchObject({ state: 'pass' });
    expect(gate.checks[3].detail).toBe('The lowest is Access-Log at 58.0%; the floor is 50.0%.');
  });

  it('says the confidence is below the floor, with both numbers', () => {
    const gate = containmentGate(input({ verdictConfidence: 0.88, floor: 0.95 }));

    expect(states(gate)).toEqual(['pass', 'pass', 'fail', 'pass']);
    expect(gate.outcome).toBe('refused');
    expect(gate.refusal).toBe('Confidence 88.0% is below the floor 95.0%.');
  });

  it('is exactly at the floor still passes (at or above)', () => {
    expect(containmentGate(input({ verdictConfidence: 0.8, floor: 0.8 })).checks[2].state).toBe('pass');
  });

  it('says which agent is under the credibility floor', () => {
    const gate = containmentGate(input({ credibility: [crs('network_traffic', 3, 0.64), crs('access_log', 3, 0.41)] }));

    expect(states(gate)).toEqual(['pass', 'pass', 'pass', 'fail']);
    expect(gate.refusal).toBe('Access-Log is at 41.0%, below the floor 50.0%.');
    expect(gate.outcome).toBe('refused');
  });

  it('an ambiguous verdict is refused at the first check, and a benign one has no actions to run', () => {
    const ambiguous = containmentGate(input({ status: 'ambiguous', verdictClass: 'ambiguous', verdictConfidence: 0.7 }));
    expect(ambiguous.checks[0].state).toBe('fail');
    expect(ambiguous.checks[1]).toMatchObject({ state: 'fail', detail: 'Ambiguous plans no containment action.' });
    expect(ambiguous.outcome).toBe('refused');

    const benign = containmentGate(input({ verdictClass: 'benign', votes: [vote('network_traffic', 'benign'), vote('access_log', 'benign')] }));
    expect(benign.checks[1]).toMatchObject({ state: 'fail', detail: 'Benign plans no containment action.' });
    expect(benign.refusal).toBe('Benign plans no containment action.');
  });

  it('every insider and external class has actions', () => {
    for (const verdictClass of ['ddos', 'port_scan', 'brute_force', 'botnet_c2', 'insider_file_exfiltration', 'insider_logon_anomaly'] as const) {
      const votes = [vote('network_traffic', verdictClass), vote('access_log', verdictClass)];
      expect(containmentGate(input({ verdictClass, votes })).checks[1].state).toBe('pass');
    }
  });

  it('a case still running has no answer yet: nothing is refused and nothing is guessed', () => {
    for (const status of [null, 'queued', 'investigating'] as const) {
      const gate = containmentGate(input({ status, verdictClass: null, verdictConfidence: null }));
      expect(gate.outcome).toBe('pending');
      expect(states(gate)).toEqual(['unknown', 'unknown', 'unknown', 'unknown']);
      expect(gate.refusal).toBeNull();
    }
  });

  it('a debate that stopped in error has no verdict and never will: it says so instead of waiting', () => {
    const gate = containmentGate(input({ status: 'error', verdictClass: null, verdictConfidence: null }));

    expect(gate.outcome).toBe('stopped');
    expect(states(gate)).toEqual(['unknown', 'unknown', 'unknown', 'unknown']);
    expect(gate.checks.every((check) => check.detail === 'The debate stopped before a verdict.')).toBe(true);
    expect(gate.refusal).toBeNull(); // nothing was refused, because nothing was judged
  });

  it('a number that is not loaded is unknown, never a pass or a fail', () => {
    const noFloor = containmentGate(input({ floor: null }));
    expect(noFloor.checks[2]).toMatchObject({ state: 'unknown', detail: 'The containment floor is not loaded.' });

    const noCredibilityFloor = containmentGate(input({ credibilityFloor: null }));
    expect(noCredibilityFloor.checks[3].state).toBe('unknown');

    const noConfidence = containmentGate(input({ verdictConfidence: null }));
    expect(noConfidence.checks[2].detail).toBe('The case has no verdict confidence.');

    const missingRecord = containmentGate(input({ credibility: [crs('network_traffic', 3, 0.64)] }));
    expect(missingRecord.checks[3]).toMatchObject({ state: 'unknown', detail: 'A supporting agent has no credibility record for this case.' });
    expect(missingRecord.outcome).toBe('pending'); // nothing failed, but not everything passed
  });

  it('an analyst can contain a case by hand when the gate says no: that is shown as such, not as a refusal', () => {
    const gate = containmentGate(input({ status: 'contained', verdictConfidence: 0.5, actions: [ACTION] }));

    expect(gate.checks[2].state).toBe('fail');
    expect(gate.outcome).toBe('manual');
  });

  it('an isolated supporter does not count', () => {
    const gate = containmentGate(
      input({
        votes: [vote('network_traffic', 'ddos'), vote('access_log', 'ddos', { counted: false })],
        credibility: [crs('network_traffic', 3, 0.64), crs('access_log', 3, 0.1)],
      }),
    );

    expect(gate.checks[3]).toMatchObject({ state: 'pass' }); // access_log was isolated and left out of the verdict
  });
});
