/**
 * Browser derivations for the Trust & Credibility screen (plan 2.7). Every output is a pure
 * function of API fields; each is shown with a Proof popover. Nothing is invented or randomised.
 */
import type { CredibilityRow, FleetEntry, InvestigatorId } from '../../api/types';

/** The three investigator agents, in the display order used across the console. */
export const INVESTIGATOR_IDS: readonly InvestigatorId[] = ['network_traffic', 'access_log', 'endpoint_behavior'];

/** Visual tone per agent (SKILL section 5): network cyan, access emerald, endpoint amber. */
export const AGENT_TONE: Record<InvestigatorId, 'primary' | 'secondary' | 'tertiary'> = {
  network_traffic: 'primary',
  access_log: 'secondary',
  endpoint_behavior: 'tertiary',
};

export type HistoryMap = Record<InvestigatorId, CredibilityRow[]>;

/** credibility_log rows come back oldest→newest; this returns the newest row, if any. */
export function latestRow(rows: readonly CredibilityRow[]): CredibilityRow | null {
  return rows.length === 0 ? null : rows[rows.length - 1];
}

/** The newest scored round's credibility change for one agent (crs_after − crs_before). */
export function agentDelta(rows: readonly CredibilityRow[]): number | null {
  const row = latestRow(rows);
  return row === null ? null : row.crs_after - row.crs_before;
}

export interface OverallDelta {
  /** Mean of each agent's newest-round delta, or null when no agent has a scored round. */
  value: number | null;
  /** How many agents contributed a delta. */
  n: number;
}

/** Mean of the agents' most-recent credibility deltas ("this cycle"), plan 2.7. */
export function overallDelta(histories: HistoryMap): OverallDelta {
  const deltas = INVESTIGATOR_IDS.map((agentId) => agentDelta(histories[agentId])).filter(
    (delta): delta is number => delta !== null,
  );
  if (deltas.length === 0) return { value: null, n: 0 };
  const sum = deltas.reduce((total, delta) => total + delta, 0);
  return { value: sum / deltas.length, n: deltas.length };
}

/**
 * Agents with at least one discrepancy (verification_match_rate < 1) in their last `window`
 * scored rounds. A discrepancy is a cited row the Watchdog could not verify exactly (plan 2.7).
 */
export function flaggedAgents(histories: HistoryMap, window = 10): InvestigatorId[] {
  return INVESTIGATOR_IDS.filter((agentId) => {
    const recent = histories[agentId].slice(-window);
    return recent.some((row) => row.verification_match_rate < 1);
  });
}

export interface IsolationGauge {
  /** Lowest current CrS across the investigators, or null when none is scored. */
  minCrs: number | null;
  /** Which agent holds that lowest CrS. */
  minAgent: InvestigatorId | null;
  /** The isolation threshold from GET /settings. */
  threshold: number;
  /** minCrs − threshold: positive margin means the lowest agent is clear of quarantine. */
  margin: number | null;
}

/**
 * The two real zones of the isolation gauge from the live threshold: quarantine below it,
 * active above it (plan 2.7). The lowest investigator's CrS and its margin are derived.
 */
export function isolationGauge(fleet: readonly FleetEntry[], threshold: number): IsolationGauge {
  let min: { crs: number; agent: InvestigatorId } | null = null;
  for (const entry of fleet) {
    if (entry.crs.value === null) continue;
    if (min === null || entry.crs.value < min.crs) min = { crs: entry.crs.value, agent: entry.agent_id };
  }
  return {
    minCrs: min?.crs ?? null,
    minAgent: min?.agent ?? null,
    threshold,
    margin: min === null ? null : min.crs - threshold,
  };
}

export interface LatestChange {
  agent: InvestigatorId;
  round: number;
  delta: number;
  matchRate: number;
  at: string;
}

/**
 * The single most-recent credibility_log change across all agents (replaces the reference's
 * invented "14% dampening" copy with the real latest adjustment, plan 2.7).
 */
export function latestChange(histories: HistoryMap): LatestChange | null {
  let best: LatestChange | null = null;
  for (const agentId of INVESTIGATOR_IDS) {
    const row = latestRow(histories[agentId]);
    if (row === null) continue;
    const at = row.created_at;
    if (best === null || at > best.at) {
      best = { agent: agentId, round: row.round, delta: row.crs_after - row.crs_before, matchRate: row.verification_match_rate, at };
    }
  }
  return best;
}
