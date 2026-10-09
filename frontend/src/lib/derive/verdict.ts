/**
 * Browser recomputation of verdict figures from the votes (plan 2.5). Each result must
 * match the server value. The Proof popover shows the formula and these inputs.
 */

export interface VoteLike {
  agent_id: string;
  verdict_class: string | null;
  confidence: number | null;
  /** false = the agent was isolated in this investigation, so the verdict leaves its vote out. */
  counted?: boolean;
}

/** The votes the verdict is made of: an isolated agent's last position is shown but not counted. */
export function countedVotes<V extends VoteLike>(votes: readonly V[]): V[] {
  return votes.filter((vote) => vote.counted !== false);
}

/** Counted votes whose class equals the verdict class. */
export function supportersOf<V extends VoteLike>(votes: readonly V[], verdictClass: string): V[] {
  return countedVotes(votes).filter((vote) => vote.verdict_class === verdictClass);
}

/**
 * Mean agent-reported confidence of the supporters. value is null and n is 0 when there
 * are no supporters with a confidence, so the caller shows "no data" and never 0.
 */
export function meanSupporterConfidence(
  votes: readonly VoteLike[],
  verdictClass: string,
): { value: number | null; n: number } {
  const values = supportersOf(votes, verdictClass)
    .map((vote) => vote.confidence)
    .filter((c): c is number => typeof c === 'number' && Number.isFinite(c));
  if (values.length === 0) return { value: null, n: 0 };
  const sum = values.reduce((total, value) => total + value, 0);
  return { value: sum / values.length, n: values.length };
}

/** Tolerance for comparing a recomputed float with the server value. */
const CONFIDENCE_TOLERANCE = 1e-6;

/**
 * Compares the browser's mean of supporters with the server's verdict_confidence.
 * "not_checkable" when either side is missing. A "mismatch" shows the red integrity badge.
 */
export function verifyVerdictConfidence(
  serverValue: number | null,
  votes: readonly VoteLike[],
  verdictClass: string,
): 'match' | 'mismatch' | 'not_checkable' {
  const computed = meanSupporterConfidence(votes, verdictClass).value;
  if (serverValue === null || computed === null) return 'not_checkable';
  return Math.abs(serverValue - computed) <= CONFIDENCE_TOLERANCE ? 'match' : 'mismatch';
}

export type QuorumStatus = 'agreed' | 'primary_decided' | 'tie' | 'unmatched' | 'no_votes';

export interface Quorum {
  status: QuorumStatus;
  winner: string | null;
  /** Votes for the leading class. */
  agreeing: number;
  /** All votes cast, including votes that matched no class. */
  voters: number;
  /** "2/3 agree", "no majority: primary agent decided", "tie → ambiguous", "no class matched" or "no votes yet". */
  label: string;
}

/**
 * Quorum from the votes, mirroring the server (backend/debate/verdict.py aggregate_verdict):
 * - a class with more votes than any other wins ("agreed");
 * - with no majority (a tie), the primary agent's class decides if it cast a real vote. The primary agent
 *   is the one whose data slice matched the injected scenario ("primary_decided");
 * - otherwise a tie stays ambiguous.
 * Votes with a null class count as voters but support no class.
 */
export function quorumFromVotes(allVotes: readonly VoteLike[], primaryAgentId: string | null = null): Quorum {
  const votes = countedVotes(allVotes);
  const voters = votes.length;
  if (voters === 0) {
    return { status: 'no_votes', winner: null, agreeing: 0, voters, label: 'no votes yet' };
  }

  const counts = new Map<string, number>();
  for (const vote of votes) {
    if (vote.verdict_class !== null) {
      counts.set(vote.verdict_class, (counts.get(vote.verdict_class) ?? 0) + 1);
    }
  }
  if (counts.size === 0) {
    return { status: 'unmatched', winner: null, agreeing: 0, voters, label: 'no class matched' };
  }

  let top = 0;
  for (const count of counts.values()) top = Math.max(top, count);
  const leaders = [...counts.entries()].filter(([, count]) => count === top).map(([name]) => name);
  if (leaders.length === 1) {
    return { status: 'agreed', winner: leaders[0], agreeing: top, voters, label: `${top}/${voters} agree` };
  }

  const primaryClass = votes.find((vote) => vote.agent_id === primaryAgentId)?.verdict_class ?? null;
  if (primaryClass !== null) {
    return {
      status: 'primary_decided',
      winner: primaryClass,
      agreeing: counts.get(primaryClass) ?? 0,
      voters,
      label: 'no majority: primary agent decided',
    };
  }
  return { status: 'tie', winner: null, agreeing: top, voters, label: 'tie → ambiguous' };
}
