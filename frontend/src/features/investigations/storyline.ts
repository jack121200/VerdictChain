/**
 * The evidence storyline of one case: the rows its investigators cited, in the order they happened. The rows are
 * re-read from raw_logs (GET /raw-logs/{row_id}); the cited fields and the Watchdog's verdict on each come from
 * the case's citations. Nothing is invented: a row that cannot be read is counted, not drawn.
 */
import type { Citation, CitationStatus, InvestigatorId, RawLogRow } from '../../api/types';
import type { Tally } from '../../lib/tally';

export interface StoryCitation {
  field: string;
  value: string | null;
  status: CitationStatus;
  agentId: InvestigatorId;
  round: number;
}

export interface StoryEvent {
  rowId: string;
  /** The row's own timestamp (ISO), null when the row has none. */
  at: string | null;
  atMs: number | null;
  source: string;
  eventType: string | null;
  user: string | null;
  host: string | null;
  citations: StoryCitation[];
  /** The worst Watchdog status among the row's citations: INVALID_ROW, then DISCREPANCY, then VERIFIED. */
  status: CitationStatus | null;
}

export interface Storyline {
  events: StoryEvent[];
  /** Users and hosts of the events, most events first, ties by name. */
  users: Tally[];
  hosts: Tally[];
  firstAt: string | null;
  lastAt: string | null;
  /** Milliseconds between the first and the last event that has a time, null with fewer than two. */
  spanMs: number | null;
}

const SEVERITY: Record<CitationStatus, number> = { VERIFIED: 0, DISCREPANCY: 1, INVALID_ROW: 2 };

function worst(citations: readonly StoryCitation[]): CitationStatus | null {
  let result: CitationStatus | null = null;
  for (const citation of citations) {
    if (result === null || SEVERITY[citation.status] > SEVERITY[result]) result = citation.status;
  }
  return result;
}

function tally(values: readonly (string | null)[]): Tally[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value !== null && value !== '') counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function buildStoryline(rows: readonly RawLogRow[], citations: readonly Citation[]): Storyline {
  const events: StoryEvent[] = rows.map((row) => {
    const seen = new Set<string>();
    const own: StoryCitation[] = [];
    for (const citation of citations) {
      if (citation.row_id !== row.row_id) continue;
      const key = `${citation.field}|${citation.value}|${citation.status}`;
      if (seen.has(key)) continue;
      seen.add(key);
      own.push({ field: citation.field, value: citation.value, status: citation.status, agentId: citation.agent_id, round: citation.round });
    }
    const atMs = row.timestamp === null ? Number.NaN : Date.parse(row.timestamp);
    return {
      rowId: row.row_id,
      at: row.timestamp,
      atMs: Number.isNaN(atMs) ? null : atMs,
      source: row.source,
      eventType: row.event_type,
      user: row.user_id,
      host: row.host_id,
      citations: own,
      status: worst(own),
    };
  });
  events.sort((a, b) => (a.atMs ?? Number.POSITIVE_INFINITY) - (b.atMs ?? Number.POSITIVE_INFINITY) || a.rowId.localeCompare(b.rowId));

  const timed = events.filter((event): event is StoryEvent & { atMs: number } => event.atMs !== null);
  return {
    events,
    users: tally(events.map((event) => event.user)),
    hosts: tally(events.map((event) => event.host)),
    firstAt: timed.length > 0 ? timed[0].at : null,
    lastAt: timed.length > 0 ? timed[timed.length - 1].at : null,
    spanMs: timed.length > 1 ? timed[timed.length - 1].atMs - timed[0].atMs : null,
  };
}
