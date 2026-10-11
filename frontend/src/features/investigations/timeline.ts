/**
 * The automation timeline of one case: when it was accepted, how long it waited for a debate slot, how long each
 * round took, when the verdict landed and when the sandbox actions ran. Every instant is the `created_at` of an
 * audit entry of the case (GET /audit-trail?investigation_id=), so every duration is a difference of two stored
 * timestamps and the Proof can show both.
 *
 * "Hands-free" means the live monitor started the case and no person appears among the actors of the entries up to
 * the last pipeline step. An analyst's feedback or sign-off afterwards does not undo that.
 */
import type { AuditEntry, VerdictClass } from '../../api/types';
import { SELF_HEALING_ACTIONS } from './derive';
import { VERDICT_LABEL } from './labels';

/** Actors that are part of the system, not a person (backend: live_runner, debate_queue, engine, watchdog, actions). */
export const AUTOMATED_ACTORS: ReadonlySet<string> = new Set(['live_monitor', 'debate_queue', 'debate_engine', 'watchdog', 'self_healing', 'system']);

export type StepKind = 'queue' | 'round' | 'verdict' | 'contain' | 'failed';

export interface TimelineStep {
  id: string;
  kind: StepKind;
  label: string;
  /** Milliseconds since the case was accepted, at the start and at the end of the step. */
  startMs: number;
  endMs: number;
  /** end minus start; 0 for a point in time such as the verdict. */
  durationMs: number;
  /** ISO time of the audit entry that ends the step. */
  at: string;
  detail: string | null;
}

export interface CaseTimeline {
  /** ISO time the case was accepted (its investigation_started entry), null with no entries. */
  startedAt: string | null;
  /** Milliseconds from acceptance to the last step, null with no steps. */
  totalMs: number | null;
  steps: TimelineStep[];
  /** Distinct actors of the case's entries, in order of first appearance. */
  actors: string[];
  /** The actors among them that are people, not the system. */
  people: string[];
  /** The live monitor started it and nobody acted before the last pipeline step. */
  handsFree: boolean;
  entryCount: number;
}

interface Stamped {
  entry: AuditEntry;
  ms: number;
}

function stamped(entries: readonly AuditEntry[]): Stamped[] {
  return entries
    .map((entry) => ({ entry, ms: Date.parse(entry.created_at) }))
    .filter((item) => !Number.isNaN(item.ms))
    .sort((a, b) => a.ms - b.ms || a.entry.seq - b.entry.seq);
}

function firstOf(items: readonly Stamped[], action: string): Stamped | null {
  return items.find((item) => item.entry.action === action) ?? null;
}

function roundNumber(entry: AuditEntry, fallback: number): number {
  const value = entry.detail?.round;
  return typeof value === 'number' ? value : fallback;
}

function verdictDetail(entry: AuditEntry): string | null {
  const verdict = entry.detail?.verdict_class;
  if (typeof verdict !== 'string') return null;
  return verdict in VERDICT_LABEL ? VERDICT_LABEL[verdict as VerdictClass] : verdict;
}

export function caseTimeline(entries: readonly AuditEntry[], triggerType: string | null): CaseTimeline {
  const items = stamped(entries);
  const start = firstOf(items, 'investigation_started') ?? items[0] ?? null;
  const actors = [...new Set(items.map((item) => item.entry.actor))];
  if (start === null) {
    return { startedAt: null, totalMs: null, steps: [], actors, people: actors.filter((actor) => !AUTOMATED_ACTORS.has(actor)), handsFree: false, entryCount: 0 };
  }

  const steps: TimelineStep[] = [];
  const add = (step: Omit<TimelineStep, 'startMs' | 'endMs' | 'durationMs'> & { startAt: number; endAt: number }) => {
    const { startAt, endAt, ...rest } = step;
    steps.push({ ...rest, startMs: startAt - start.ms, endMs: endAt - start.ms, durationMs: endAt - startAt });
  };

  let cursor = start.ms;
  const claimed = firstOf(items, 'debate_started');
  if (claimed !== null && claimed.ms >= start.ms) {
    add({ id: 'queue', kind: 'queue', label: 'Queue', startAt: start.ms, endAt: claimed.ms, at: claimed.entry.created_at, detail: 'waited for a free debate slot' });
    cursor = claimed.ms;
  }

  const rounds = items.filter((item) => item.entry.action === 'round_completed');
  rounds.forEach((item, index) => {
    const number = roundNumber(item.entry, index + 1);
    add({ id: `round-${number}`, kind: 'round', label: `Round ${number}`, startAt: cursor, endAt: item.ms, at: item.entry.created_at, detail: null });
    cursor = item.ms;
  });

  const verdict = firstOf(items, 'verdict_reached');
  if (verdict !== null) {
    add({ id: 'verdict', kind: 'verdict', label: 'Verdict', startAt: verdict.ms, endAt: verdict.ms, at: verdict.entry.created_at, detail: verdictDetail(verdict.entry) });
  }

  const actions = items.filter((item) => SELF_HEALING_ACTIONS.has(item.entry.action) && item.ms >= (verdict?.ms ?? start.ms));
  if (actions.length > 0) {
    const last = actions[actions.length - 1];
    add({
      id: 'contain',
      kind: 'contain',
      label: 'Containment',
      startAt: verdict?.ms ?? actions[0].ms,
      endAt: last.ms,
      at: last.entry.created_at,
      detail: `${actions.length} sandbox ${actions.length === 1 ? 'action' : 'actions'}`,
    });
  }

  const failure = firstOf(items, 'investigation_failed');
  if (failure !== null) {
    add({ id: 'failed', kind: 'failed', label: 'Stopped', startAt: failure.ms, endAt: failure.ms, at: failure.entry.created_at, detail: null });
  }

  const pipelineEnd = steps.length > 0 ? start.ms + Math.max(...steps.map((step) => step.endMs)) : start.ms;
  const people = actors.filter((actor) => !AUTOMATED_ACTORS.has(actor));
  const peopleBefore = new Set(items.filter((item) => item.ms <= pipelineEnd && !AUTOMATED_ACTORS.has(item.entry.actor)).map((item) => item.entry.actor));
  return {
    startedAt: start.entry.created_at,
    totalMs: steps.length > 0 ? pipelineEnd - start.ms : null,
    steps,
    actors,
    people,
    handsFree: triggerType === 'continuous' && peopleBefore.size === 0,
    entryCount: items.length,
  };
}
