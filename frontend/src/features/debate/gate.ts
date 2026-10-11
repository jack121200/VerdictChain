/**
 * Why a case was, or was not, contained by the Self-Healing agent (checklist CT16). A pure function that mirrors
 * should_respond() in backend/self_healing/actions.py plus the rule that benign and ambiguous verdicts plan no
 * action (_plan_actions):
 *   1. the debate reached a verdict (status verdict_reached; contained means it already passed),
 *   2. the class is one that has actions (external: ddos, port_scan, brute_force, botnet_c2; insider: two classes),
 *   3. the verdict confidence is at or above the containment floor (GET /settings verdict_confidence_threshold),
 *   4. every supporting agent's credibility after its last round is at or above the starting CrS
 *      (GET /settings starting_crs; AUTONOMOUS_ACTION_MIN_CRS is that constant in backend/watchdog/credibility.py).
 * Everything is an API field. Nothing is typed in except these four rules, and the Proof shows them.
 */
import type { CredibilityRow, InvestigationStatus, InvestigatorId, ResponseAction, VerdictClass, Vote } from '../../api/types';
import { supportersOf } from '../../lib/derive/verdict';
import { formatPercent } from '../../lib/format';
import { VERDICT_LABEL } from './derive';

export type GateCheckId = 'verdict' | 'class' | 'confidence' | 'credibility';
export type GateState = 'pass' | 'fail' | 'unknown';

export interface GateCheck {
  id: GateCheckId;
  state: GateState;
  title: string;
  detail: string;
}

/**
 * passed: every check passed. refused: a check failed and nothing was contained. pending: no verdict yet.
 * stopped: the debate ended in error, so there is no verdict and there never will be one for this case.
 * manual: a check failed but actions exist, because an analyst ran containment by hand (that route skips the gate).
 */
export type GateOutcome = 'passed' | 'refused' | 'pending' | 'stopped' | 'manual';

export interface ContainmentGate {
  checks: GateCheck[];
  outcome: GateOutcome;
  /** The sentence for the first check that failed, or null. */
  refusal: string | null;
}

export interface GateInput {
  status: InvestigationStatus | null;
  verdictClass: VerdictClass | null;
  verdictConfidence: number | null;
  /** GET /settings verdict_confidence_threshold, or null while it is not loaded. */
  floor: number | null;
  /** GET /settings starting_crs, or null while it is not loaded. */
  credibilityFloor: number | null;
  votes: readonly Vote[];
  credibility: readonly CredibilityRow[];
  actions: readonly ResponseAction[];
  agentName: (agentId: InvestigatorId) => string;
}

const ACTIONABLE: ReadonlySet<VerdictClass> = new Set([
  'ddos',
  'port_scan',
  'brute_force',
  'botnet_c2',
  'insider_file_exfiltration',
  'insider_logon_anomaly',
]);

const PERCENT = (value: number) => formatPercent(value, 1);

function lastCrsAfter(rows: readonly CredibilityRow[], agentId: InvestigatorId): number | null {
  const own = rows.filter((row) => row.agent_id === agentId).sort((a, b) => a.round - b.round);
  return own.length > 0 ? own[own.length - 1].crs_after : null;
}

export function containmentGate(input: GateInput): ContainmentGate {
  const { status, verdictClass, verdictConfidence, floor, credibilityFloor, votes, credibility, actions } = input;
  const hasVerdict = status === 'verdict_reached' || status === 'contained' || status === 'ambiguous';

  if (!hasVerdict) {
    const stopped = status === 'error';
    const waiting = stopped ? 'The debate stopped before a verdict.' : 'no verdict yet';
    const unknown = (id: GateCheckId, title: string): GateCheck => ({ id, state: 'unknown', title, detail: waiting });
    return {
      outcome: stopped ? 'stopped' : 'pending',
      refusal: null,
      checks: [
        unknown('verdict', 'A verdict was reached'),
        unknown('class', 'The class has containment actions'),
        unknown('confidence', 'Confidence is at or above the containment floor'),
        unknown('credibility', 'Every supporting agent is at or above the credibility floor'),
      ],
    };
  }

  const checks: GateCheck[] = [];

  // 1. a verdict
  checks.push(
    status === 'ambiguous'
      ? {
          id: 'verdict',
          state: 'fail',
          title: 'A verdict was reached',
          detail: 'The verdict is ambiguous (no majority and no primary-agent class, or fewer than two agents finished).',
        }
      : { id: 'verdict', state: 'pass', title: 'A verdict was reached', detail: 'The agents agreed on a class.' },
  );

  // 2. a class that has actions
  const label = verdictClass === null ? null : VERDICT_LABEL[verdictClass];
  checks.push(
    verdictClass !== null && ACTIONABLE.has(verdictClass)
      ? { id: 'class', state: 'pass', title: 'The class has containment actions', detail: `${label} plans sandbox actions.` }
      : {
          id: 'class',
          state: 'fail',
          title: 'The class has containment actions',
          detail: `${label ?? 'This verdict'} plans no containment action.`,
        },
  );

  // 3. confidence against the floor
  if (verdictConfidence === null || floor === null) {
    checks.push({
      id: 'confidence',
      state: 'unknown',
      title: 'Confidence is at or above the containment floor',
      detail: verdictConfidence === null ? 'The case has no verdict confidence.' : 'The containment floor is not loaded.',
    });
  } else if (verdictConfidence >= floor) {
    checks.push({
      id: 'confidence',
      state: 'pass',
      title: 'Confidence is at or above the containment floor',
      detail: `${PERCENT(verdictConfidence)} is at or above the floor ${PERCENT(floor)}.`,
    });
  } else {
    checks.push({
      id: 'confidence',
      state: 'fail',
      title: 'Confidence is at or above the containment floor',
      detail: `Confidence ${PERCENT(verdictConfidence)} is below the floor ${PERCENT(floor)}.`,
    });
  }

  // 4. the credibility of the supporting agents
  const supporters = verdictClass === null ? [] : supportersOf(votes, verdictClass);
  const scores = supporters.map((vote) => ({ agentId: vote.agent_id, crs: lastCrsAfter(credibility, vote.agent_id) }));
  const known = scores.filter((score): score is { agentId: InvestigatorId; crs: number } => score.crs !== null);
  if (credibilityFloor === null || supporters.length === 0 || known.length < scores.length) {
    checks.push({
      id: 'credibility',
      state: 'unknown',
      title: 'Every supporting agent is at or above the credibility floor',
      detail:
        credibilityFloor === null
          ? 'The credibility floor is not loaded.'
          : supporters.length === 0
            ? 'No agent supports a class.'
            : 'A supporting agent has no credibility record for this case.',
    });
  } else {
    const lowest = known.reduce((low, score) => (score.crs < low.crs ? score : low));
    checks.push(
      lowest.crs >= credibilityFloor
        ? {
            id: 'credibility',
            state: 'pass',
            title: 'Every supporting agent is at or above the credibility floor',
            detail: `The lowest is ${input.agentName(lowest.agentId)} at ${PERCENT(lowest.crs)}; the floor is ${PERCENT(credibilityFloor)}.`,
          }
        : {
            id: 'credibility',
            state: 'fail',
            title: 'Every supporting agent is at or above the credibility floor',
            detail: `${input.agentName(lowest.agentId)} is at ${PERCENT(lowest.crs)}, below the floor ${PERCENT(credibilityFloor)}.`,
          },
    );
  }

  const failed = checks.find((check) => check.state === 'fail') ?? null;
  const everyPassed = checks.every((check) => check.state === 'pass');
  if (failed === null) {
    return { checks, refusal: null, outcome: everyPassed || actions.length > 0 ? 'passed' : 'pending' };
  }
  return { checks, refusal: failed.detail, outcome: actions.length > 0 ? 'manual' : 'refused' };
}
