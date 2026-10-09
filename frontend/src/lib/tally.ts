export interface Tally {
  value: string;
  count: number;
}

/**
 * The most frequent value of a count map. A tie goes to the lexicographically smallest value (plain string
 * order), so the same citations always give the same subject or host, whatever order they arrived in.
 */
export function topByCount(counts: ReadonlyMap<string, number>): Tally | null {
  let best: Tally | null = null;
  for (const [value, count] of counts) {
    if (best === null || count > best.count || (count === best.count && value < best.value)) best = { value, count };
  }
  return best;
}
