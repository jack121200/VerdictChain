/**
 * Display labels and visual tones for the real API enums (plan R7). The raw codes
 * (ddos, insider_file_exfiltration, running, …) are shown in mono as evidence; these
 * maps add a human-readable label and a status colour. No value here is data.
 */
import type { InvestigationStatus, VerdictClass } from '../../api/types';
import type { IconName } from '../../ui/icon-names';
import type { Tone } from '../../ui/classes';

export type PillTone = Tone | 'neutral';

/** The four external-attack classes (CICIDS2017 family). */
const EXTERNAL: ReadonlySet<VerdictClass> = new Set(['ddos', 'port_scan', 'brute_force', 'botnet_c2']);
/** The two insider classes (CERT family). */
const INSIDER: ReadonlySet<VerdictClass> = new Set(['insider_file_exfiltration', 'insider_logon_anomaly']);

export const VERDICT_LABEL: Record<VerdictClass, string> = {
  ddos: 'DDoS',
  port_scan: 'Port scan',
  brute_force: 'Brute force',
  botnet_c2: 'Botnet C2',
  insider_file_exfiltration: 'Insider file exfiltration',
  insider_logon_anomaly: 'Insider logon anomaly',
  benign: 'Benign',
  ambiguous: 'Ambiguous',
};

export const STATUS_LABEL: Record<InvestigationStatus, string> = {
  queued: 'Queued',
  investigating: 'Investigating',
  verdict_reached: 'Verdict reached',
  ambiguous: 'Ambiguous',
  contained: 'Contained',
  error: 'Failed',
};

/** Colour role for a verdict class. Insider = critical, external = warning, benign = safe. */
export function verdictTone(verdict: VerdictClass | null): PillTone {
  if (verdict === null) return 'primary';
  if (INSIDER.has(verdict)) return 'error';
  if (EXTERNAL.has(verdict)) return 'tertiary';
  if (verdict === 'benign') return 'secondary';
  return 'neutral';
}

/** Status glyph for a verdict class (colour is never the only signal, SKILL section 4). */
export function verdictIcon(verdict: VerdictClass | null): IconName {
  if (verdict === null) return 'info';
  if (INSIDER.has(verdict)) return 'warning';
  if (EXTERNAL.has(verdict)) return 'warning';
  if (verdict === 'benign') return 'check';
  return 'error';
}

/** Glyph for an investigation status: a status colour always has a shape beside it (SKILL section 4). */
export function statusIcon(status: InvestigationStatus): IconName {
  switch (status) {
    case 'queued':
      return 'schedule';
    case 'investigating':
      return 'sync';
    case 'verdict_reached':
      return 'check_circle';
    case 'ambiguous':
      return 'info';
    case 'contained':
      return 'shield';
    case 'error':
      return 'cancel';
  }
}

/** Colour role for an investigation status. */
export function statusTone(status: InvestigationStatus): PillTone {
  switch (status) {
    case 'queued':
      return 'neutral';
    case 'contained':
      return 'error';
    case 'verdict_reached':
      return 'secondary';
    case 'investigating':
      return 'primary';
    case 'error':
      return 'error';
    case 'ambiguous':
      return 'neutral';
  }
}
