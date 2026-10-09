/**
 * Pure derivations for the Debate Room (plan 2.5). Everything here is a function of API fields,
 * unit-tested, and shown in a Proof popover on screen. Nothing is typed in.
 */
import type {
  CitationStatus,
  CredibilityRow,
  DebateRound,
  InvestigationDetail,
  InvestigationStatus,
  InvestigatorId,
  LiveFrame,
  ResponseAction,
  RoundAgentTurn,
  VerdictClass,
  Vote,
} from '../../api/types';
import type { Tone } from '../../ui/classes';
import type { IconName } from '../../ui/icon-names';

/** The merged live/replay state of one investigation. Seeded from the detail, updated by WS frames. */
export interface LiveDebate {
  status: InvestigationStatus | null;
  verdictClass: VerdictClass | null;
  verdictConfidence: number | null;
  rounds: DebateRound[];
  credibility: CredibilityRow[];
  actions: ResponseAction[];
  votes: Vote[];
}

export function emptyDebate(): LiveDebate {
  return { status: null, verdictClass: null, verdictConfidence: null, rounds: [], credibility: [], actions: [], votes: [] };
}

function sortRounds(rounds: readonly DebateRound[]): DebateRound[] {
  return [...rounds].sort((a, b) => a.round - b.round);
}

/** Authoritative state from GET /investigations/{id}. */
export function fromDetail(detail: InvestigationDetail): LiveDebate {
  return {
    status: detail.status,
    verdictClass: detail.verdict_class,
    verdictConfidence: detail.verdict_confidence,
    rounds: sortRounds(detail.rounds),
    credibility: detail.credibility,
    actions: detail.actions,
    votes: detail.votes,
  };
}

function upsertRound(rounds: readonly DebateRound[], round: number, agents: RoundAgentTurn[]): DebateRound[] {
  const kept = rounds.filter((item) => item.round !== round);
  return [...kept, { round, agents }].sort((a, b) => a.round - b.round);
}

/** Applies one live WS frame to the state. Pure, so it is unit-tested directly. */
export function applyFrame(state: LiveDebate, frame: LiveFrame): LiveDebate {
  switch (frame.type) {
    case 'snapshot':
      return {
        ...state,
        status: frame.status,
        verdictClass: frame.verdict?.verdict_class ?? state.verdictClass,
        verdictConfidence: frame.verdict?.verdict_confidence ?? state.verdictConfidence,
        rounds: sortRounds(frame.rounds),
        credibility: frame.credibility,
        actions: frame.actions,
      };
    case 'round_completed':
      return { ...state, rounds: upsertRound(state.rounds, frame.round, frame.agents) };
    case 'agent_isolated':
      return state;
    case 'verdict':
      return {
        ...state,
        verdictClass: frame.verdict,
        status: frame.status,
        actions: frame.actions_taken.length > 0 ? frame.actions_taken : state.actions,
      };
    case 'error':
      return state;
  }
}

// ---- round stepper ---------------------------------------------------------------

export type RoundState = 'complete' | 'active' | 'pending';

export interface RoundStep {
  round: number;
  state: RoundState;
  title: string;
}

const ROUND_TITLES = ['Theory generation & ingestion', 'Cross-examination & refutation', 'Synthesis & consensus'];

export function roundTitle(round: number): string {
  return ROUND_TITLES[round - 1] ?? `Round ${round}`;
}

/**
 * Round N is complete when all active agents have a turn in it, or a later round exists, or the
 * debate has finished. The first incomplete round while running is active; the rest are pending.
 */
export function roundSteps(
  rounds: readonly DebateRound[],
  totalRounds: number,
  status: InvestigationStatus | null,
  activeAgentCount: number,
): RoundStep[] {
  const present = new Map<number, number>(rounds.map((round) => [round.round, round.agents.length]));
  const maxPresent = rounds.reduce((top, round) => Math.max(top, round.round), 0);
  const running = status === 'investigating' || status === null;

  const steps: RoundStep[] = [];
  for (let round = 1; round <= totalRounds; round += 1) {
    const title = roundTitle(round);
    const count = present.get(round);
    if (count !== undefined) {
      const full = count >= activeAgentCount || present.has(round + 1) || !running;
      steps.push({ round, state: full ? 'complete' : 'active', title });
    } else if (running && round === maxPresent + 1) {
      steps.push({ round, state: 'active', title });
    } else {
      steps.push({ round, state: 'pending', title });
    }
  }
  return steps;
}

// ---- per-agent lane --------------------------------------------------------------

export interface AgentLane {
  agentId: InvestigatorId;
  turns: Array<{ round: number; turn: RoundAgentTurn }>;
  latest: RoundAgentTurn | null;
  firstConfidence: number | null;
  latestConfidence: number | null;
  citedCount: number;
}

export function laneFor(rounds: readonly DebateRound[], agentId: InvestigatorId): AgentLane {
  const turns = sortRounds(rounds)
    .map((round) => ({ round: round.round, turn: round.agents.find((agent) => agent.agent_id === agentId) }))
    .filter((entry): entry is { round: number; turn: RoundAgentTurn } => entry.turn !== undefined);
  const latest = turns.length > 0 ? turns[turns.length - 1].turn : null;
  const firstConfidence = turns.length > 0 ? turns[0].turn.confidence : null;
  const latestConfidence = latest ? latest.confidence : null;
  const citedCount = latest ? latest.cited_evidence.length : 0;
  return { agentId, turns, latest, firstConfidence, latestConfidence, citedCount };
}

// ---- stance, badges, providers ----------------------------------------------------

export function stanceLabel(stance: string | null): string {
  return stance ?? 'stance not stated';
}

export function stanceTone(stance: string | null): Tone | 'neutral' {
  if (stance === 'SUPPORT') return 'secondary';
  if (stance === 'CHALLENGE') return 'tertiary';
  if (stance === 'REVISE') return 'primary';
  return 'neutral';
}

const ROUND_BADGE = ['Theory proposal', 'Cross-examination', 'Synthesis'];

export function roundBadge(round: number): string {
  return ROUND_BADGE[round - 1] ?? `Round ${round}`;
}

/** Distinct, persisted per-call providers used across the transcript (plan 2.5: no t/s). */
export function providersUsed(rounds: readonly DebateRound[]): string[] {
  const seen = new Set<string>();
  for (const round of rounds) {
    for (const agent of round.agents) {
      if (agent.provider) seen.add(agent.provider);
    }
  }
  return [...seen];
}

// ---- verdict labels and citation status ------------------------------------------

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

const INSIDER: ReadonlySet<VerdictClass> = new Set(['insider_file_exfiltration', 'insider_logon_anomaly']);
const EXTERNAL: ReadonlySet<VerdictClass> = new Set(['ddos', 'port_scan', 'brute_force', 'botnet_c2']);

export function verdictTone(verdict: VerdictClass | null): Tone | 'neutral' {
  if (verdict === null) return 'neutral';
  if (INSIDER.has(verdict) || EXTERNAL.has(verdict)) return 'error';
  if (verdict === 'benign') return 'secondary';
  return 'tertiary';
}

export interface CitationMeta {
  tone: Tone;
  icon: IconName;
  label: string;
}

export function citationMeta(status: CitationStatus): CitationMeta {
  switch (status) {
    case 'VERIFIED':
      return { tone: 'secondary', icon: 'verified_user', label: 'Verified' };
    case 'DISCREPANCY':
      return { tone: 'tertiary', icon: 'error', label: 'Discrepancy' };
    case 'INVALID_ROW':
      return { tone: 'error', icon: 'warning', label: 'Invalid row' };
  }
}

/** The most-cited value of a field across citations (subject / host attribution). */
export function mostCitedValue(citations: ReadonlyArray<{ field: string; value: string | null }>, field: string): string | null {
  const counts = new Map<string, number>();
  for (const citation of citations) {
    if (citation.field === field && citation.value !== null) counts.set(citation.value, (counts.get(citation.value) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** Earliest parseable timestamp among cited time-like fields, as the trigger time. */
export function earliestCitedTimestamp(citations: ReadonlyArray<{ field: string; value: string | null }>): string | null {
  let best: { iso: string; ms: number } | null = null;
  for (const citation of citations) {
    if (!/time|timestamp|date/i.test(citation.field) || citation.value === null) continue;
    const ms = new Date(citation.value).getTime();
    if (Number.isNaN(ms)) continue;
    if (best === null || ms < best.ms) best = { iso: citation.value, ms };
  }
  return best?.iso ?? null;
}
