import { describe, expect, it } from 'vitest';
import type { InvestigationDetail, ResponseAction, Vote } from '../../api/types';
import { metric } from '../../test/fixtures';
import { healingStatus, playbook } from '../investigations/healing';
import type { CaseTimeline } from '../investigations/timeline';
import { executiveSummary } from './summary';

const AGENTS = ['network_traffic', 'access_log', 'endpoint_behavior'] as const;
const at = (seconds: number) => new Date(Date.parse('2026-10-11T10:00:00Z') + seconds * 1000).toISOString();

function vote(agent_id: Vote['agent_id'], verdict_class: Vote['verdict_class'], counted = true): Vote {
  return { agent_id, verdict_class, confidence: 0.9, class_source: 'stated', matched_keywords: [], counted };
}

function detail(overrides: Partial<InvestigationDetail> = {}): InvestigationDetail {
  return {
    id: 'inv-1',
    status: 'contained',
    verdict_class: 'ddos',
    verdict_confidence: 0.9,
    primary_agent: 'network_traffic',
    dataset: 'CICIDS2017',
    noise_pct: 0,
    effective_noise_pct: null,
    data_source: 'model',
    error_reason: null,
    trigger_type: 'continuous',
    trigger_reason: 'network window: flows of one rate',
    rounds: [1, 2, 3].map((round) => ({
      round,
      agents: AGENTS.map((agent_id) => ({ agent_id, theory: 't', confidence: 0.9, stance: 'SUPPORT' as const, provider: 'openai', cited_evidence: [], credibility: 0.8 })),
    })),
    citations: { total: 10, verified: 9, discrepancy: 1, invalid_row: 0, match_rate: metric(0.9) },
    credibility: [],
    actions: [],
    votes: [vote('network_traffic', 'ddos'), vote('access_log', 'ddos'), vote('endpoint_behavior', 'benign')],
    created_at: at(0),
    ...overrides,
  };
}

const action = (id: string, type: string, seconds: number): ResponseAction => ({ id, investigation_id: 'inv-1', action_type: type, target: 'U1', reason: 'r', is_simulated: true, created_at: at(seconds) });

const TIMELINE: CaseTimeline = { startedAt: at(0), totalMs: 29000, steps: [], actors: [], people: [], handsFree: true, entryCount: 8 };
const gate = { checks: [], outcome: 'passed' as const, refusal: null };

function summarise(overrides: Partial<InvestigationDetail> = {}, timeline: CaseTimeline | null = TIMELINE, rounds: number | null = 3) {
  const d = detail(overrides);
  const steps = playbook(d.actions, at(27.5));
  return executiveSummary({ detail: d, timeline, rounds, healing: healingStatus(gate, d.status, d.verdict_class, steps), steps });
}

describe('executiveSummary', () => {
  it('tells an automatic, contained case in six sentences, every one from a field', () => {
    const sentences = summarise({ actions: [action('a', 'lock_account', 28.7), action('b', 'trigger_audit', 29)] });

    expect(sentences).toEqual([
      'The live monitor opened this investigation at 2026-10-11 10:00:00 UTC on the CICIDS2017 data. Trigger: network window: flows of one rate.',
      '3 investigators read their own slices of the logs and debated for 3 rounds. Final votes: DDoS ×2, Benign ×1.',
      'The aggregator reached a verdict of DDoS with an agent-reported confidence of 90.0%. That is the mean of the supporting agents\' self-reported confidence; it is not accuracy.',
      'The Watchdog re-checked 10 cited values against the raw logs: 9 verified, 1 discrepancy and 0 invalid rows (match rate 90.0%).',
      'The Self-Healing agent ran 2 sandboxed actions (lock account, open an audit), the first 1.2 s after the verdict. Every action is simulated; nothing reached a real system.',
      'From acceptance to the last recorded step took 29.0 s, with no analyst action in between.',
    ]);
  });

  it('says an analyst opened a manual case and leaves out what it cannot know', () => {
    const sentences = summarise({ trigger_type: 'manual', trigger_reason: null, dataset: null, votes: [] }, null, null);

    expect(sentences[0]).toBe('An analyst opened this investigation.');
    expect(sentences[1]).toBe('3 investigators read their own slices of the logs and debated for 3 rounds.'); // length from the rounds seen
    expect(sentences.some((sentence) => sentence.startsWith('From acceptance'))).toBe(false);
  });

  it('gives the reason a debate stopped instead of a verdict', () => {
    const sentences = summarise({ status: 'error', verdict_class: null, verdict_confidence: null, error_reason: 'OpenAI refused the request.', actions: [] });

    expect(sentences).toContain('The debate stopped before a verdict: OpenAI refused the request.');
    expect(sentences.some((sentence) => sentence.startsWith('Self-Healing:'))).toBe(true);
  });

  it('says the primary investigator decided when no class had a majority, and only then', () => {
    const split = summarise({ votes: [vote('network_traffic', 'ddos'), vote('access_log', 'insider_file_exfiltration'), vote('endpoint_behavior', 'insider_logon_anomaly')] });
    expect(split[2]).toContain("No class had a majority, so the aggregator's tie-break applied: the class of the primary investigator");
    expect(split[1]).toContain('Final votes: DDoS ×1, Insider file exfiltration ×1, Insider logon anomaly ×1.');

    const majority = summarise({ votes: [vote('network_traffic', 'ddos'), vote('access_log', 'ddos'), vote('endpoint_behavior', 'insider_logon_anomaly')] });
    expect(majority[2]).not.toContain('tie-break');
  });

  it('says what the agent decided when it ran nothing', () => {
    const sentences = summarise({ status: 'verdict_reached', verdict_class: 'benign', actions: [] });

    expect(sentences).toContain('Self-Healing: No action needed. The agents read the rows as benign. Benign verdicts plan no containment.');
  });

  it('does not count a vote of an isolated agent', () => {
    const sentences = summarise({ votes: [vote('network_traffic', 'ddos'), vote('access_log', 'ddos', false), vote('endpoint_behavior', 'ddos')] });
    expect(sentences[1]).toContain('Final votes: DDoS ×2.');
  });
});
