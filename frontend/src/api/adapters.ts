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
