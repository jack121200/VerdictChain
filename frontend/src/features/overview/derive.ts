import type { AuditEntry } from '../../api/types';

export interface MeanLatency {
  /** Mean milliseconds between investigation_started and verdict_reached, or null when none completed. */
  meanMs: number | null;
  /** Number of investigations that have both a start and a verdict entry. */
  n: number;
}

/**
 * Derives mean adjudication latency from audit timestamps (plan 2.3): for each investigation,
 * verdict_reached.created_at minus investigation_started.created_at. A pure function of API fields,
 * so its formula and n show in the Proof popover. Non-negative deltas only.
 */
export function deriveMeanLatencyMs(entries: readonly AuditEntry[]): MeanLatency {
  const startedAt = new Map<string, number>();
  for (const entry of entries) {
    if (entry.investigation_id === null || entry.action !== 'investigation_started') continue;
    const time = new Date(entry.created_at).getTime();
    if (!Number.isNaN(time)) startedAt.set(entry.investigation_id, time);
  }

  const deltas: number[] = [];
  for (const entry of entries) {
    if (entry.investigation_id === null || entry.action !== 'verdict_reached') continue;
    const start = startedAt.get(entry.investigation_id);
    if (start === undefined) continue;
    const verdict = new Date(entry.created_at).getTime();
    if (Number.isNaN(verdict)) continue;
    const delta = verdict - start;
    if (delta >= 0) deltas.push(delta);
  }

  if (deltas.length === 0) return { meanMs: null, n: 0 };
  const total = deltas.reduce((sum, value) => sum + value, 0);
  return { meanMs: total / deltas.length, n: deltas.length };
}
