/**
 * Wire -> model adapters. Pure functions, so every conversion is unit-tested against payloads captured
 * from the real backend (adapters.test.ts). The wire types are in types.ts; scripts/contract-check.mjs
 * proves they match the live API.
 */
import type {
  AgentVoteWire,
  CredibilityRow,
  CredibilityWire,
  DebateRound,
  DebateRoundWire,
  GlobalCitation,
  InvestigationDetail,
  InvestigationDetailWire,
  InvestigationListParams,
  InvestigationPage,
  InvestigationSummary,
  InvestigationSummaryWire,
  Metric,
  LiveActionWire,
  LiveTurnWire,
  ResponseAction,
  RoundAgentTurn,
  Vote,
  CitationListParams,
  CitationPage,
} from './types';

/** A Metric for a value the API does not report: null with the reason, never a made-up number. */
function notReported(source: string, reason: string): Metric<number> {
  return { value: null, n: 0, as_of: new Date().toISOString(), source, definition: reason, reason };
}

export function toInvestigationSummary(wire: InvestigationSummaryWire): InvestigationSummary {
  const { investigation_id, ...rest } = wire;
  return { id: investigation_id, ...rest };
}

/**
 * GET /investigations is a bare array. The API does not report a total, so total is a null Metric with that
 * reason; paging works off "a full page means there may be more".
 */
export function toInvestigationPage(rows: InvestigationSummaryWire[], params: InvestigationListParams): InvestigationPage {
  return {
    items: rows.map(toInvestigationSummary),
    total: notReported('GET /investigations', 'the list endpoint pages without a total count'),
    limit: params.limit ?? rows.length,
    offset: params.offset ?? 0,
  };
}

export function toCitationPage(rows: GlobalCitation[], params: CitationListParams): CitationPage {
  return {
    items: rows,
    total: notReported('GET /citations', 'the citations endpoint pages without a total count'),
    limit: params.limit ?? rows.length,
    offset: params.offset ?? 0,
  };
}

/** Credibility after one agent's turn in a round, from the credibility log. null when it was not scored. */
function crsAfter(credibility: CredibilityWire[], agentId: string, round: number): number | null {
  const row = credibility.find((entry) => entry.agent_id === agentId && entry.round === round);
  return row ? row.crs_after : null;
}

/** Groups the flat debate rows into rounds, attaching each turn's credibility. Rounds ascend; agents keep arrival order. */
export function groupRounds(debate: DebateRoundWire[], credibility: CredibilityWire[]): DebateRound[] {
  const byRound = new Map<number, RoundAgentTurn[]>();
  for (const row of debate) {
    const turn: RoundAgentTurn = {
      agent_id: row.agent_id,
      theory: row.theory,
      confidence: row.confidence,
      stance: row.stance,
      provider: row.provider,
      cited_evidence: row.cited_evidence,
      credibility: crsAfter(credibility, row.agent_id, row.round),
    };
    const turns = byRound.get(row.round);
    if (turns) turns.push(turn);
    else byRound.set(row.round, [turn]);
  }
  return [...byRound.entries()].sort(([a], [b]) => a - b).map(([round, agents]) => ({ round, agents }));
}

/** The server sends each agent's latest vote. confidence is that agent's confidence in the same round. */
/** The CrS after a round, from the score dict a round_completed frame carries (or a bare number). */
function crsAfterOf(raw: LiveTurnWire['credibility']): number | null {
  if (typeof raw === 'number') return raw;
  if (raw && typeof raw === 'object' && typeof raw.crs_after === 'number') return raw.crs_after;
  return null;
}

/**
 * A live-frame turn in the model shape. `fallbackCrs` fills the credibility of a snapshot turn from the
 * snapshot's own credibility rows; a stance the frame does not carry stays null (the browser never parses theory text).
 */
export function toLiveTurn(raw: LiveTurnWire, fallbackCrs: number | null = null): RoundAgentTurn {
  return {
    agent_id: raw.agent_id,
    theory: raw.theory,
    confidence: raw.confidence,
    stance: raw.stance ?? null,
    provider: raw.provider ?? null,
    cited_evidence: raw.cited_evidence,
    credibility: crsAfterOf(raw.credibility) ?? fallbackCrs,
  };
}

/** The credibility row a round_completed frame implies for one agent, or null when it carried no score dict. */
export function creditRowFromFrame(
  investigationId: string,
  round: number,
  raw: LiveTurnWire,
): CredibilityRow | null {
  const score = raw.credibility;
  if (!score || typeof score !== 'object') return null;
  return {
    investigation_id: investigationId,
    agent_id: raw.agent_id,
    round,
    crs_before: score.crs_before,
    crs_after: score.crs_after,
    verification_match_rate: score.verification_match_rate ?? 0,
    isolated: score.isolated ?? false,
    created_at: '',
  };
}

/** Snapshot credibility rows in the model shape. The rows are keyed by agent and round, so no id is needed. */
export function toLiveCredibility(
  rows: Array<Omit<CredibilityRow, 'investigation_id' | 'created_at'> & Partial<CredibilityRow>>,
  investigationId: string,
): CredibilityRow[] {
  return rows.map((row) => ({
    ...row,
    investigation_id: row.investigation_id ?? investigationId,
    created_at: row.created_at ?? '',
  }));
}

/** Actions in the model shape. A row without an id (the snapshot) gets a stable key from its position. */
export function toLiveActions(raw: LiveActionWire[], investigationId: string): ResponseAction[] {
  return raw.map((action, index) => ({
    id: action.id ?? `${investigationId}:${index}`,
    investigation_id: action.investigation_id ?? investigationId,
    action_type: action.action_type,
    target: action.target,
    reason: action.reason,
    is_simulated: action.is_simulated,
    created_at: action.created_at ?? '',
  }));
}

export function toVotes(votes: AgentVoteWire[], debate: DebateRoundWire[]): Vote[] {
  return votes.map((vote) => {
    const turn = debate.find((row) => row.agent_id === vote.agent_id && row.round === vote.round);
    return {
      agent_id: vote.agent_id,
      verdict_class: vote.vote_class === 'unclassified' ? null : vote.vote_class,
      confidence: turn ? turn.confidence : null,
      matched_keywords: vote.matched_keywords,
      counted: vote.counted,
    };
  });
}

function toCredibilityRow(investigationId: string, row: CredibilityWire): CredibilityRow {
  return { investigation_id: investigationId, ...row };
}

export function toInvestigationDetail(wire: InvestigationDetailWire): InvestigationDetail {
  const id = wire.investigation_id;
  const actions: ResponseAction[] = wire.actions.map((action) => ({
    ...action,
    investigation_id: action.investigation_id ?? id,
  }));
  return {
    id,
    status: wire.status,
    verdict_class: wire.verdict_class,
    verdict_confidence: wire.verdict_confidence,
    primary_agent: wire.primary_agent,
    dataset: wire.dataset,
    noise_pct: wire.noise_pct,
    effective_noise_pct: wire.effective_noise_pct,
    trigger_type: wire.trigger_type,
    // The API never exposes trigger_reason (it can name the injected scenario, which agents and the UI
    // must not see), so it is always null here.
    trigger_reason: null,
    rounds: groupRounds(wire.debate, wire.credibility),
    citations: wire.citations,
    credibility: wire.credibility.map((row) => toCredibilityRow(id, row)),
    actions,
    votes: toVotes(wire.votes, wire.debate),
    input_basis: wire.input_basis ?? {},
    created_at: wire.created_at,
  };
}
