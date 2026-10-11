/**
 * Pure derivations for the Debate Room (plan 2.5). Everything here is a function of API fields,
 * unit-tested, and shown in a Proof popover on screen. Nothing is typed in.
 */
import type {
  CitationStatus,
  CredibilityRow,
  DebateRound,
  InvestigationDetail,
  InputBasis,
  InputBasisKind,
  InvestigationStatus,
  InvestigatorId,
  LiveFrame,
  ResponseAction,
  RoundAgentTurn,
  VerdictClass,
  Vote,
} from '../../api/types';
import { creditRowFromFrame, toLiveActions, toLiveCredibility, toLiveTurn } from '../../api/adapters';
import { isVerifiedClaim } from '../../lib/derive/citations';
import type { Quorum } from '../../lib/derive/verdict';
import { topByCount } from '../../lib/tally';
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
  /** How each agent's data slice was chosen. Empty for an investigation that predates the record. */
  inputBasis: Record<string, InputBasis>;
  /** Why the debate stopped (status error): the stored reason, or the live error frame's text. */
  errorReason: string | null;
}

export function emptyDebate(): LiveDebate {
  return {
    status: null,
    verdictClass: null,
    verdictConfidence: null,
    rounds: [],
    credibility: [],
    actions: [],
    votes: [],
    inputBasis: {},
    errorReason: null,
  };
}

/** Words for the input basis, best first (backend/debate/state.py). The detail goes into the Proof popover. */
export const INPUT_BASIS_LABEL: Record<InputBasisKind, { label: string; detail: string }> = {
  scenario_rows: {
    label: 'scenario rows',
    detail: "The scenario itself carries rows of this agent's domain, so these are the case's own rows.",
  },
  same_user_window: {
    label: 'same user · time window',
    detail: "Rows of the same user(s) the scenario names, inside the scenario's time window (plus or minus 24 hours).",
  },
  time_window: {
    label: 'time window',
    detail: "Rows of this agent's domain inside the scenario's time window (plus or minus 24 hours), for other users.",
  },
  recent_sample: {
    label: 'recent sample',
    detail:
      "No rows of this agent's domain fall in the scenario's time window (the datasets do not overlap in time), so the newest rows of the domain were used. They are unrelated to the case.",
  },
};

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
    inputBasis: detail.input_basis ?? {},
    errorReason: detail.error_reason,
  };
}

function upsertRound(rounds: readonly DebateRound[], round: number, agents: RoundAgentTurn[]): DebateRound[] {
  const kept = rounds.filter((item) => item.round !== round);
  return [...kept, { round, agents }].sort((a, b) => a.round - b.round);
}

/**
 * The verdict a live "verdict" frame carries. The engine (backend/debate/engine.py) sends the whole verdict dict:
 * { verdict_class, verdict_confidence, status, supporting_evidence, contributing_agents }. Anything that is not
 * that object (a missing field, an unknown class, a bare string) reads as "not stated", so a frame can never put
 * a non-text value into the page.
 */
export function readVerdictPayload(raw: unknown): { verdictClass: VerdictClass | null; confidence: number | null } {
  if (typeof raw !== 'object' || raw === null) return { verdictClass: null, confidence: null };
  const record = raw as Record<string, unknown>;
  const verdictClass = record.verdict_class;
  const confidence = record.verdict_confidence;
  return {
    verdictClass: typeof verdictClass === 'string' && Object.prototype.hasOwnProperty.call(VERDICT_LABEL, verdictClass) ? (verdictClass as VerdictClass) : null,
    confidence: typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : null,
  };
}

/** Applies one live WS frame to the state. Pure, so it is unit-tested directly. */
export function applyFrame(state: LiveDebate, frame: LiveFrame): LiveDebate {
  switch (frame.type) {
    case 'snapshot': {
      // The page has already loaded the detail from REST, which is richer than the snapshot (stance, credibility,
      // action ids). The snapshot only adds what the state does not have yet, so it never replaces better data.
      const id = frame.investigation_id;
      let rounds = state.rounds;
      for (const round of frame.rounds) {
        const known = rounds.find((item) => item.round === round.round)?.agents ?? [];
        const missing = round.agents
          .filter((agent) => !known.some((turn) => turn.agent_id === agent.agent_id))
          .map((agent) => {
            const row = frame.credibility.find((c) => c.agent_id === agent.agent_id && c.round === round.round);
            return toLiveTurn(agent, row?.crs_after ?? null);
          });
        if (missing.length > 0) rounds = upsertRound(rounds, round.round, [...known, ...missing]);
      }
      const have = new Set(state.credibility.map((row) => `${row.agent_id}:${row.round}`));
      const credibility = [
        ...state.credibility,
        ...toLiveCredibility(frame.credibility, id).filter((row) => !have.has(`${row.agent_id}:${row.round}`)),
      ];
      return {
        ...state,
        status: frame.status,
        verdictClass: frame.verdict?.verdict_class ?? state.verdictClass,
        verdictConfidence: frame.verdict?.verdict_confidence ?? state.verdictConfidence,
        rounds: sortRounds(rounds),
        credibility,
        actions: state.actions.length > 0 ? state.actions : toLiveActions(frame.actions, id),
      };
    }
    case 'round_completed': {
      const rows = frame.agents
        .map((agent) => creditRowFromFrame(frame.investigation_id, frame.round, agent))
        .filter((row): row is CredibilityRow => row !== null);
      const replaced = new Set(rows.map((row) => `${row.agent_id}:${row.round}`));
      return {
        ...state,
        rounds: upsertRound(state.rounds, frame.round, frame.agents.map((agent) => toLiveTurn(agent))),
        credibility: [...state.credibility.filter((row) => !replaced.has(`${row.agent_id}:${row.round}`)), ...rows],
      };
    }
    case 'agent_isolated':
      return state;
    case 'verdict': {
      const verdict = readVerdictPayload(frame.verdict);
      return {
        ...state,
        verdictClass: verdict.verdictClass ?? state.verdictClass,
        verdictConfidence: verdict.confidence ?? state.verdictConfidence,
        status: frame.status,
        // actions_taken holds only { action_type, target, reason }. The full rows (id, is_simulated) arrive with the
        // reload the page runs on a verdict frame, so the frame's partial rows are not shown.
      };
    }
    case 'error':
      // The engine has marked the investigation error: say so now, and keep the reason it gave.
      return { ...state, status: 'error', errorReason: frame.detail };
  }
}

// ---- round stepper ---------------------------------------------------------------

export type RoundState = 'complete' | 'active' | 'pending' | 'stopped';

export interface RoundStep {
  round: number;
  state: RoundState;
  title: string;
  /** Agents that answered in this round, and how many were expected. */
  answered: number;
  expected: number;
}

const ROUND_TITLES = ['Theory generation & ingestion', 'Cross-examination & refutation', 'Synthesis & consensus'];

export function roundTitle(round: number): string {
  return ROUND_TITLES[round - 1] ?? `Round ${round}`;
}

/**
 * Round N is complete when all active agents have a turn in it, or a later round exists, or the
 * debate has finished. The first incomplete round while running is active; the rest are pending. When the
 * debate ended in error, the round that was cut off is stopped (it says how many agents had answered) and
 * the rounds after it never ran, so they stay pending.
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
  const failed = status === 'error';

  const steps: RoundStep[] = [];
  let stoppedAt: number | null = null;
  for (let round = 1; round <= totalRounds; round += 1) {
    const title = roundTitle(round);
    const count = present.get(round);
    const base = { round, title, answered: count ?? 0, expected: activeAgentCount };
    if (count !== undefined) {
      const full = count >= activeAgentCount || present.has(round + 1) || (!running && !failed);
      if (!full && failed) stoppedAt = round;
      steps.push({ ...base, state: full ? 'complete' : failed ? 'stopped' : 'active' });
    } else if (running && round === maxPresent + 1) {
      steps.push({ ...base, state: 'active' });
    } else if (failed && round === maxPresent + 1 && stoppedAt === null) {
      stoppedAt = round;
      steps.push({ ...base, state: 'stopped' });
    } else {
      steps.push({ ...base, state: 'pending' });
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

/**
 * Why an agent has nothing to show in this debate, or null when it took part.
 * - quarantined: it has no turns and the fleet reports it isolated. The engine leaves a quarantined agent out
 *   from the start (a quarantine is rejected while a debate is in flight, and an agent the Watchdog isolates
 *   mid-debate has already spoken), so it never took part.
 * - no_turns: the debate is finished and the agent has no turns, but it is not quarantined now (restored since,
 *   or the cause was not recorded). Only the fact is stated, not a reason.
 * A running debate whose agent has simply not spoken yet is null: the lane keeps its "not recorded yet" wording.
 */
export type LaneAbsence = 'quarantined' | 'no_turns' | null;

export function laneAbsence(lane: AgentLane, isolatedNow: boolean, status: InvestigationStatus | null): LaneAbsence {
  if (lane.turns.length > 0) return null;
  if (isolatedNow) return 'quarantined';
  const finished = status !== null && status !== 'investigating' && status !== 'queued';
  return finished ? 'no_turns' : null;
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

/**
 * The pill beside "Verdict aggregator". A debate that stopped in error never reached a vote, so it must not
 * claim a quorum: the votes the API lists for it are only each agent's latest answer, classified.
 */
export function quorumPill(status: InvestigationStatus | null, quorum: Quorum): { label: string; tone: Tone | 'neutral' } {
  if (status === 'error') return { label: 'no quorum: the debate stopped', tone: 'error' };
  const tone = quorum.status === 'agreed' || quorum.status === 'primary_decided' ? 'secondary' : quorum.status === 'no_votes' ? 'neutral' : 'tertiary';
  return { label: quorum.label, tone };
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

/**
 * The most-cited value of a field across VERIFIED citations (subject / host attribution).
 * A tie is broken by the lexicographically smallest value.
 */
export function mostCitedValue(
  citations: ReadonlyArray<{ field: string; value: string | null; status?: string }>,
  field: string,
): string | null {
  const counts = new Map<string, number>();
  for (const citation of citations) {
    if (citation.field === field && citation.value !== null && isVerifiedClaim(citation)) {
      counts.set(citation.value, (counts.get(citation.value) ?? 0) + 1);
    }
  }
  return topByCount(counts)?.value ?? null;
}

/** Earliest parseable timestamp among cited time-like fields, as the trigger time. */
export function earliestCitedTimestamp(
  citations: ReadonlyArray<{ field: string; value: string | null; status?: string }>,
): string | null {
  let best: { iso: string; ms: number } | null = null;
  for (const citation of citations) {
    if (!/time|timestamp|date/i.test(citation.field) || citation.value === null) continue;
    if (!isVerifiedClaim(citation)) continue;
    const ms = new Date(citation.value).getTime();
    if (Number.isNaN(ms)) continue;
    if (best === null || ms < best.ms) best = { iso: citation.value, ms };
  }
  return best?.iso ?? null;
}
