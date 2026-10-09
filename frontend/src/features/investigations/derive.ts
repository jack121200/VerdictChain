/**
 * Browser derivations for the dossier inspector (plan 2.6). Every output is a pure function
 * of API fields; the Proof popover shows the formula and these inputs. Nothing is invented.
 */
import type { AuditEntry, Citation } from '../../api/types';
import { isVerifiedClaim } from '../../lib/derive/citations';
import { topByCount, type Tally } from '../../lib/tally';

/** Field names, lower-cased, that identify the subject user in a cited row. */
const USER_FIELDS: ReadonlySet<string> = new Set(['user_id', 'user', 'username', 'actor']);
/** Field names, lower-cased, that identify the host in a cited row. */
const HOST_FIELDS: ReadonlySet<string> = new Set(['host_id', 'host', 'hostname', 'pc']);
/** Field names, lower-cased, that carry a timestamp in a cited row. */
const TIME_FIELDS: ReadonlySet<string> = new Set(['timestamp', 'time', 'date', 'ts']);

/** The four real sandbox action names (plan 3.2 AUDIT_ACTIONS). */
export const SELF_HEALING_ACTIONS: ReadonlySet<string> = new Set([
  'lock_account',
  'block_ip_range',
  'trigger_rate_limiting',
  'trigger_audit',
]);

export type { Tally };

export interface Attribution {
  /** Most-cited user field value across the citations, or null when none was cited. */
  subject: Tally | null;
  /** Most-cited host field value, or null. */
  host: Tally | null;
  /** Earliest valid timestamp among cited timestamp fields, or null. */
  earliestCitedTimestamp: string | null;
  /** How many citations were scanned. */
  citationCount: number;
}

/** Picks the most frequent VERIFIED value for the fields in `names`; a tie goes to the lexicographically smallest value. */
function topValue(citations: readonly Citation[], names: ReadonlySet<string>): Tally | null {
  const counts = new Map<string, number>();
  for (const citation of citations) {
    if (citation.value === null || !isVerifiedClaim(citation)) continue;
    if (!names.has(citation.field.toLowerCase())) continue;
    counts.set(citation.value, (counts.get(citation.value) ?? 0) + 1);
  }
  return topByCount(counts);
}

/** Derives the attributed subject, host and trigger time from an investigation's cited rows. */
export function attributionFromCitations(citations: readonly Citation[]): Attribution {
  let earliest: { iso: string; ms: number } | null = null;
  for (const citation of citations) {
    if (citation.value === null || !isVerifiedClaim(citation)) continue;
    if (!TIME_FIELDS.has(citation.field.toLowerCase())) continue;
    const ms = Date.parse(citation.value);
    if (Number.isNaN(ms)) continue;
    if (earliest === null || ms < earliest.ms) earliest = { iso: citation.value, ms };
  }
  return {
    subject: topValue(citations, USER_FIELDS),
    host: topValue(citations, HOST_FIELDS),
    earliestCitedTimestamp: earliest?.iso ?? null,
    citationCount: citations.length,
  };
}

export interface ContainmentLatency {
  /** Milliseconds from the verdict entry to the first sandbox action, or null. */
  value: number | null;
  reason: string | null;
  verdictAt: string | null;
  firstActionAt: string | null;
  firstAction: string | null;
}

/**
 * Measured latency from the `verdict_reached` audit entry to the first self-healing action
 * entry for the same investigation (plan 2.6 "sandbox applied within N ms"). n = 1 measurement.
 */
export function containmentLatency(entries: readonly AuditEntry[]): ContainmentLatency {
  let verdict: { iso: string; ms: number } | null = null;
  for (const entry of entries) {
    if (entry.action !== 'verdict_reached') continue;
    const ms = Date.parse(entry.created_at);
    if (Number.isNaN(ms)) continue;
    if (verdict === null || ms < verdict.ms) verdict = { iso: entry.created_at, ms };
  }
  if (verdict === null) {
    return { value: null, reason: 'no verdict recorded for this case', verdictAt: null, firstActionAt: null, firstAction: null };
  }

  let action: { iso: string; ms: number; name: string } | null = null;
  for (const entry of entries) {
    if (!SELF_HEALING_ACTIONS.has(entry.action)) continue;
    const ms = Date.parse(entry.created_at);
    if (Number.isNaN(ms) || ms < verdict.ms) continue;
    if (action === null || ms < action.ms) action = { iso: entry.created_at, ms, name: entry.action };
  }
  if (action === null) {
    return { value: null, reason: 'no containment action recorded', verdictAt: verdict.iso, firstActionAt: null, firstAction: null };
  }
  return { value: action.ms - verdict.ms, reason: null, verdictAt: verdict.iso, firstActionAt: action.iso, firstAction: action.name };
}
