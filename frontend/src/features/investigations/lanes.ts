/**
 * The parallel investigation lanes: one lane per debate slot (GET /system/status.debate_slot.capacity), each
 * either holding a running investigation or idle. The running ids are the slot holders; the details of a lane
 * come from the investigations list when it already knows the case.
 */
import type { InvestigationSummary } from '../../api/types';

export interface Lane {
  /** 1-based number shown on the lane. */
  number: number;
  /** The investigation id the lane holds, null while the lane is idle. */
  id: string | null;
  /** The list row of that investigation, null when idle or when the list does not have it yet. */
  item: InvestigationSummary | null;
}

/**
 * capacity null (status not loaded) gives only the lanes that are busy. More running ids than slots (a setting
 * lowered while debates run) still shows every running debate.
 */
export function buildLanes(capacity: number | null, runningIds: readonly string[], known: readonly InvestigationSummary[]): Lane[] {
  const count = Math.max(capacity ?? 0, runningIds.length);
  return Array.from({ length: count }, (_, index) => {
    const id = runningIds[index] ?? null;
    return { number: index + 1, id, item: id === null ? null : (known.find((item) => item.id === id) ?? null) };
  });
}
