import { describe, expect, it } from 'vitest';
import { meanSupporterConfidence, quorumFromVotes, supportersOf, verifyVerdictConfidence, type VoteLike } from './verdict';

const votes: VoteLike[] = [
  { agent_id: 'network_traffic', verdict_class: 'ddos', confidence: 0.9 },
  { agent_id: 'access_log', verdict_class: 'ddos', confidence: 0.7 },
  { agent_id: 'endpoint_behavior', verdict_class: 'benign', confidence: 0.4 },
];

describe('verdict derivations', () => {
  it('averages confidence over the supporters of the verdict class only', () => {
    expect(supportersOf(votes, 'ddos')).toHaveLength(2);
    const mean = meanSupporterConfidence(votes, 'ddos');
    expect(mean.n).toBe(2);
    expect(mean.value).toBeCloseTo(0.8, 10);
  });

  it('returns null with n 0 when nothing supports the class, never 0', () => {
    expect(meanSupporterConfidence(votes, 'port_scan')).toEqual({ value: null, n: 0 });
  });

  it('checks the server verdict confidence against the recomputed mean', () => {
    expect(verifyVerdictConfidence(0.8, votes, 'ddos')).toBe('match');
    expect(verifyVerdictConfidence(0.5, votes, 'ddos')).toBe('mismatch');
    expect(verifyVerdictConfidence(null, votes, 'ddos')).toBe('not_checkable');
    expect(verifyVerdictConfidence(0.8, [], 'ddos')).toBe('not_checkable');
  });

  it('reports the leading class as agreed with the vote count', () => {
    expect(quorumFromVotes(votes)).toMatchObject({ status: 'agreed', winner: 'ddos', agreeing: 2, voters: 3, label: '2/3 agree' });
  });

  it('reports a tie as ambiguous, with no winner', () => {
    const tied: VoteLike[] = [
      { agent_id: 'a', verdict_class: 'ddos', confidence: 0.5 },
      { agent_id: 'b', verdict_class: 'benign', confidence: 0.5 },
    ];
    expect(quorumFromVotes(tied)).toMatchObject({ status: 'tie', winner: null, label: 'tie → ambiguous' });
  });

  it('distinguishes no votes from votes that matched no class', () => {
    expect(quorumFromVotes([])).toMatchObject({ status: 'no_votes', voters: 0 });
    const unmatched: VoteLike[] = [{ agent_id: 'a', verdict_class: null, confidence: null }];
    expect(quorumFromVotes(unmatched)).toMatchObject({ status: 'unmatched', voters: 1, label: 'no class matched' });
  });
});
