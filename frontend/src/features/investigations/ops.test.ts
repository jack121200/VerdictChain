import { describe, expect, it } from 'vitest';
import type { AuditAction, AuditEntry, Citation, InvestigationSummary, RawLogRow, ResponseAction } from '../../api/types';
import type { ContainmentGate } from '../debate/gate';
import { actionLabel, healingStatus, playbook } from './healing';
import { buildLanes } from './lanes';
import { casePipeline, triggerLabel } from './pipeline';
import { buildStoryline } from './storyline';
import { caseTimeline } from './timeline';

const T0 = Date.parse('2026-10-11T10:00:00Z');
const iso = (offsetSeconds: number) => new Date(T0 + offsetSeconds * 1000).toISOString();

let seq = 0;
function entry(action: AuditAction, actor: string, offsetSeconds: number, detail: AuditEntry['detail'] = null): AuditEntry {
  seq += 1;
  return {
    seq,
    prev_hash: null,
    entry_hash: `hash-${seq}`,
    hash_input: `input-${seq}`,
    actor,
    action,
    detail,
    investigation_id: 'inv-1',
    created_at: iso(offsetSeconds),
  };
}

/** One automatic case that ran end to end: queued 2 s, rounds of 8, 8 and 9 s, verdict, two sandbox actions. */
function automaticCase(): AuditEntry[] {
  return [
    entry('investigation_started', 'live_monitor', 0),
    entry('debate_started', 'debate_queue', 2),
    entry('round_completed', 'debate_engine', 10, { round: 1 }),
    entry('round_completed', 'debate_engine', 18, { round: 2 }),
    entry('round_completed', 'debate_engine', 27, { round: 3 }),
    entry('verdict_reached', 'debate_engine', 27.5, { verdict_class: 'ddos' }),
    entry('lock_account', 'self_healing', 28.7),
    entry('trigger_audit', 'self_healing', 29),
  ];
}

function summary(overrides: Partial<InvestigationSummary> = {}): InvestigationSummary {
  return {
    id: 'inv-1',
    status: 'investigating',
    verdict_class: null,
    verdict_confidence: null,
    primary_agent: 'network_traffic',
    dataset: 'CICIDS2017',
    noise_pct: 0,
    rounds_complete: 0,
    containment_count: 0,
    data_source: 'model',
    error_reason: null,
    trigger_type: 'continuous',
    created_at: iso(0),
    ...overrides,
  };
}

describe('casePipeline', () => {
  const states = (item: Partial<InvestigationSummary>, rounds: number | null = 3) => casePipeline(summary(item), rounds).map((stage) => `${stage.id}:${stage.state}:${stage.detail}`);

  it('shows a queued automatic case as detected and waiting', () => {
    expect(states({ status: 'queued' })).toEqual(['detect:done:live monitor', 'debate:pending:queued', 'verdict:pending:—', 'contain:pending:—']);
  });

  it('shows the debate as active with the rounds done out of the settings total', () => {
    expect(states({ rounds_complete: 2 })[1]).toBe('debate:active:2/3');
  });

  it('shows a contained case as done at every stage, with its action count', () => {
    expect(states({ status: 'contained', verdict_class: 'ddos', rounds_complete: 3, containment_count: 2 })).toEqual([
      'detect:done:live monitor',
      'debate:done:3/3',
      'verdict:done:DDoS',
      'contain:done:2 actions',
    ]);
  });

  it('skips containment for a verdict that plans no action', () => {
    expect(states({ status: 'verdict_reached', verdict_class: 'benign', rounds_complete: 3 })[3]).toBe('contain:skipped:no action');
  });

  it('marks a debate that stopped as failed and has no verdict', () => {
    expect(states({ status: 'error', rounds_complete: 1 })).toEqual(['detect:done:live monitor', 'debate:failed:1/3', 'verdict:failed:none', 'contain:skipped:—']);
  });

  it('counts the rounds without a total while the settings are not loaded', () => {
    expect(states({ rounds_complete: 1 }, null)[1]).toBe('debate:active:1 round');
  });

  it('names who started the case', () => {
    expect(triggerLabel('continuous')).toBe('live monitor');
    expect(triggerLabel('manual')).toBe('analyst');
    expect(triggerLabel('scheduled')).toBe('scheduled');
  });
});

describe('buildLanes', () => {
  it('has one lane per slot, the busy ones first, each matched to its list row when known', () => {
    const known = [summary({ id: 'a' })];
    const lanes = buildLanes(4, ['a', 'b'], known);
    expect(lanes.map((lane) => [lane.number, lane.id])).toEqual([[1, 'a'], [2, 'b'], [3, null], [4, null]]);
    expect(lanes[0].item?.id).toBe('a');
    expect(lanes[1].item).toBeNull(); // running, but the list has not caught up yet
  });

  it('shows only the busy lanes while the capacity is unknown', () => {
    expect(buildLanes(null, [], [])).toEqual([]);
    expect(buildLanes(null, ['a'], []).map((lane) => lane.id)).toEqual(['a']);
  });

  it('still shows every running debate when the capacity was lowered under them', () => {
    expect(buildLanes(1, ['a', 'b', 'c'], [])).toHaveLength(3);
  });
});

describe('caseTimeline', () => {
  it('measures the queue, each round, the verdict and the containment from the audit entries', () => {
    const timeline = caseTimeline(automaticCase(), 'continuous');

    expect(timeline.steps.map((step) => [step.id, step.durationMs, step.startMs, step.endMs])).toEqual([
      ['queue', 2000, 0, 2000],
      ['round-1', 8000, 2000, 10000],
      ['round-2', 8000, 10000, 18000],
      ['round-3', 9000, 18000, 27000],
      ['verdict', 0, 27500, 27500],
      ['contain', 1500, 27500, 29000],
    ]);
    expect(timeline.steps[4].detail).toBe('DDoS');
    expect(timeline.steps[5].detail).toBe('2 sandbox actions');
    expect(timeline.totalMs).toBe(29000);
    expect(timeline.startedAt).toBe(iso(0));
    expect(timeline.entryCount).toBe(8);
  });

  it('does not depend on the order the entries arrive in (the API lists the newest first)', () => {
    const shuffled = [...automaticCase()].reverse();
    expect(caseTimeline(shuffled, 'continuous').steps.map((step) => step.id)).toEqual(['queue', 'round-1', 'round-2', 'round-3', 'verdict', 'contain']);
  });

  it('is hands-free when the monitor started it and only the system acted', () => {
    const timeline = caseTimeline(automaticCase(), 'continuous');
    expect(timeline.handsFree).toBe(true);
    expect(timeline.people).toEqual([]);
    expect(timeline.actors).toEqual(['live_monitor', 'debate_queue', 'debate_engine', 'self_healing']);
  });

  it('stays hands-free when an analyst only gives feedback after the pipeline has finished', () => {
    const timeline = caseTimeline([...automaticCase(), entry('analyst_feedback', 'soc_lead', 300)], 'continuous');
    expect(timeline.handsFree).toBe(true);
    expect(timeline.people).toEqual(['soc_lead']);
  });

  it('is not hands-free when a person acted before the last step, or when a person started it', () => {
    expect(caseTimeline([...automaticCase(), entry('emergency_containment', 'soc_lead', 20)], 'continuous').handsFree).toBe(false);
    expect(caseTimeline(automaticCase(), 'manual').handsFree).toBe(false);
  });

  it('marks a case that stopped, and gives nothing for a case with no entries', () => {
    const stopped = caseTimeline([entry('investigation_started', 'live_monitor', 0), entry('debate_started', 'debate_queue', 1), entry('investigation_failed', 'debate_engine', 5)], 'continuous');
    expect(stopped.steps.map((step) => step.kind)).toEqual(['queue', 'failed']);
    expect(caseTimeline([], 'continuous')).toMatchObject({ startedAt: null, totalMs: null, steps: [], handsFree: false, entryCount: 0 });
  });
});

describe('the Self-Healing playbook', () => {
  const action = (id: string, type: string, offsetSeconds: number, extra: Partial<ResponseAction> = {}): ResponseAction => ({
    id,
    investigation_id: 'inv-1',
    action_type: type,
    target: 'U001',
    reason: 'because',
    is_simulated: true,
    created_at: iso(offsetSeconds),
    ...extra,
  });

  it('lists the actions oldest first with the time after the verdict', () => {
    const steps = playbook([action('b', 'trigger_audit', 31), action('a', 'lock_account', 29)], iso(28));
    expect(steps.map((step) => [step.label, step.offsetMs])).toEqual([['Lock account', 1000], ['Open an audit', 3000]]);
    expect(playbook([action('a', 'lock_account', 29)], null)[0].offsetMs).toBeNull();
  });

  it('puts a release in words and marks it as the inverse', () => {
    expect(actionLabel('release:block_ip_range')).toBe('Release: Block IP range');
    expect(actionLabel('mystery')).toBe('mystery');
    expect(playbook([action('a', 'release:lock_account', 40)], null)[0].released).toBe(true);
  });

  const gate = (outcome: ContainmentGate['outcome'], refusal: string | null = null): ContainmentGate => ({ checks: [], outcome, refusal });

  it('says where the case stands with the agent', () => {
    const steps = playbook([action('a', 'lock_account', 29)], iso(28));
    const released = playbook([action('a', 'lock_account', 29), action('b', 'release:lock_account', 40)], iso(28));
    expect(healingStatus(gate('passed'), 'contained', 'ddos', steps).label).toBe('Contained in the sandbox');
    expect(healingStatus(gate('manual', 'x'), 'contained', 'ddos', steps).label).toBe('Contained by an analyst');
    expect(healingStatus(gate('passed'), 'verdict_reached', 'ddos', released).label).toBe('Released');
    expect(healingStatus(gate('pending'), 'investigating', null, []).label).toBe('Waiting for a verdict');
    expect(healingStatus(gate('stopped'), 'error', null, []).label).toBe('No verdict');
    expect(healingStatus(gate('refused', 'Confidence 70.0% is below the floor 80.0%.'), 'verdict_reached', 'ddos', [])).toMatchObject({
      label: 'Held by the gate',
      sentence: 'Confidence 70.0% is below the floor 80.0%.',
    });
  });

  it('calls a benign or ambiguous verdict "no action needed", not a refusal', () => {
    expect(healingStatus(gate('refused', 'Benign plans no containment action.'), 'verdict_reached', 'benign', []).label).toBe('No action needed');
    expect(healingStatus(gate('refused', 'The verdict is ambiguous'), 'ambiguous', 'ambiguous', []).label).toBe('No action needed');
  });
});

describe('buildStoryline', () => {
  const row = (id: string, offsetSeconds: number | null, overrides: Partial<RawLogRow> = {}): RawLogRow => ({
    row_id: id,
    timestamp: offsetSeconds === null ? null : iso(offsetSeconds),
    source: 'cert_r4.2_logon',
    source_file: 'logon.csv',
    event_type: 'logon',
    user_id: 'U001',
    host_id: 'PC-1',
    severity: null,
    raw_fields: {},
    ...overrides,
  });
  const cite = (rowId: string, field: string, value: string, status: Citation['status'] = 'VERIFIED', agent: Citation['agent_id'] = 'endpoint_behavior'): Citation => ({
    row_id: rowId,
    field,
    value,
    expected: value,
    status,
    reason: status === 'VERIFIED' ? 'ok' : 'value_mismatch',
    agent_id: agent,
    round: 1,
    row_fingerprint: null,
  });

  it('orders the cited rows by their own time and attaches what was cited about each', () => {
    const story = buildStoryline(
      [row('late', 90), row('early', 10), row('untimed', null)],
      [cite('late', 'off_hours', 'true'), cite('late', 'off_hours', 'true'), cite('early', 'logon_count', '3', 'DISCREPANCY')],
    );

    expect(story.events.map((event) => event.rowId)).toEqual(['early', 'late', 'untimed']);
    expect(story.events[1].citations).toHaveLength(1); // the repeated citation is shown once
    expect(story.events.map((event) => event.status)).toEqual(['DISCREPANCY', 'VERIFIED', null]);
    expect(story.firstAt).toBe(iso(10));
    expect(story.lastAt).toBe(iso(90));
    expect(story.spanMs).toBe(80_000);
  });

  it('tallies the users and hosts, most events first and ties by name', () => {
    const story = buildStoryline(
      [row('a', 1), row('b', 2, { user_id: 'U002', host_id: 'PC-1' }), row('c', 3), row('d', 4, { user_id: null, host_id: null })],
      [],
    );
    expect(story.users).toEqual([{ value: 'U001', count: 2 }, { value: 'U002', count: 1 }]);
    expect(story.hosts).toEqual([{ value: 'PC-1', count: 3 }]);
  });

  it('has no span with fewer than two timed rows and no events for no rows', () => {
    expect(buildStoryline([row('a', 1)], []).spanMs).toBeNull();
    expect(buildStoryline([], [])).toMatchObject({ events: [], firstAt: null, lastAt: null, spanMs: null });
  });

  it('takes the worst status of a row: invalid beats discrepancy beats verified', () => {
    const story = buildStoryline([row('a', 1)], [cite('a', 'f', '1'), cite('a', 'g', '2', 'INVALID_ROW'), cite('a', 'h', '3', 'DISCREPANCY')]);
    expect(story.events[0].status).toBe('INVALID_ROW');
  });
});
