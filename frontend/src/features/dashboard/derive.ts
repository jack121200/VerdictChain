import type { Citation, InvestigationStatus, VerdictClass } from '../../api/types';
import type { CitationStatus } from '../../api/types';
import { isVerifiedClaim } from '../../lib/derive/citations';
import { topByCount } from '../../lib/tally';
import type { Tone } from '../../ui/classes';
import type { IconName } from '../../ui/icon-names';

/** Verdict classes that mean a threat was found (everything except benign/ambiguous/none). */
const THREAT_CLASSES: ReadonlySet<VerdictClass> = new Set<VerdictClass>([
  'ddos',
  'port_scan',
  'brute_force',
  'botnet_c2',
  'insider_file_exfiltration',
  'insider_logon_anomaly',
]);

export function isThreatClass(verdictClass: VerdictClass | null): boolean {
  return verdictClass !== null && THREAT_CLASSES.has(verdictClass);
}

export interface StatusMeta {
  tone: Tone | 'neutral';
  label: string;
}

/** Pill tone and label for an investigation status. */
export function investigationStatusMeta(status: InvestigationStatus): StatusMeta {
  switch (status) {
    case 'queued':
      return { tone: 'neutral', label: 'Queued' };
    case 'investigating':
      return { tone: 'primary', label: 'Running' };
    case 'verdict_reached':
      return { tone: 'secondary', label: 'Verdict reached' };
    case 'contained':
      return { tone: 'primary', label: 'Contained' };
    case 'ambiguous':
      return { tone: 'tertiary', label: 'Ambiguous' };
    case 'error':
      return { tone: 'error', label: 'Failed' };
  }
}

export interface CitationStatusMeta {
  tone: Tone;
  icon: IconName;
  label: string;
}

/** Colour-plus-shape for a citation status (SKILL section 4). */
export function citationStatusMeta(status: CitationStatus): CitationStatusMeta {
  switch (status) {
    case 'VERIFIED':
      return { tone: 'secondary', icon: 'verified_user', label: 'Verified' };
    case 'DISCREPANCY':
      return { tone: 'tertiary', icon: 'error', label: 'Discrepancy' };
    case 'INVALID_ROW':
      return { tone: 'error', icon: 'warning', label: 'Invalid row' };
  }
}

/** Pill tone for a verdict class: threat classes are critical, benign is safe, the rest neutral. */
export function verdictClassTone(verdictClass: VerdictClass | null): Tone | 'neutral' {
  if (verdictClass === null) return 'neutral';
  if (isThreatClass(verdictClass)) return 'error';
  if (verdictClass === 'benign') return 'secondary';
  return 'tertiary'; // ambiguous
}

/**
 * The most-cited value of a field across VERIFIED citations, for example the subject user_id.
 * A tie is broken by the lexicographically smallest value.
 */
export function mostCitedValue(citations: readonly Citation[], field: string): string | null {
  const counts = new Map<string, number>();
  for (const citation of citations) {
    if (citation.field === field && citation.value !== null && isVerifiedClaim(citation)) {
      counts.set(citation.value, (counts.get(citation.value) ?? 0) + 1);
    }
  }
  return topByCount(counts)?.value ?? null;
}
