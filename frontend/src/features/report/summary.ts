/**
 * The plain-words summary at the top of the case report. Every sentence is a template over fields the API returned
 * (status, votes, citations, actions, audit timestamps): nothing is written by a model and nothing is guessed. A part
 * that is missing leaves its sentence out rather than inventing it.
 */
import type { InvestigationDetail, VerdictClass } from '../../api/types';
import { quorumFromVotes } from '../../lib/derive/verdict';
import { formatCount, formatCountNoun, formatDuration, formatPercent, formatTimestamp } from '../../lib/format';
import { actionLabel, type HealingStatus, type PlaybookStep } from '../investigations/healing';
import { VERDICT_LABEL } from '../investigations/labels';
import type { CaseTimeline } from '../investigations/timeline';

export interface SummaryInput {
  detail: InvestigationDetail;
  timeline: CaseTimeline | null;
  /** Debate length from GET /settings, null when it could not be read. */
  rounds: number | null;
  healing: HealingStatus;
  steps: readonly PlaybookStep[];
}

function startedBy(triggerType: string): string {
  if (triggerType === 'continuous') return 'The live monitor';
  if (triggerType === 'manual') return 'An analyst';
  return `The ${triggerType} trigger`;
}

/** "DDoS ×3, Benign ×1" from the counted votes, most votes first. */
function tally(detail: InvestigationDetail): string | null {
  const counts = new Map<VerdictClass, number>();
  for (const vote of detail.votes) {
    if (vote.counted === false || vote.verdict_class === null) continue;
    counts.set(vote.verdict_class, (counts.get(vote.verdict_class) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  return [...counts]
    .sort((a, b) => b[1] - a[1] || VERDICT_LABEL[a[0]].localeCompare(VERDICT_LABEL[b[0]]))
    .map(([verdict, count]) => `${VERDICT_LABEL[verdict]} ×${formatCount(count)}`)
    .join(', ');
}

export function executiveSummary({ detail, timeline, rounds, healing, steps }: SummaryInput): string[] {
  const sentences: string[] = [];

  const when = timeline?.startedAt ? ` at ${formatTimestamp(timeline.startedAt)}` : '';
  const dataset = detail.dataset ? ` on the ${detail.dataset} data` : '';
  const reason = detail.trigger_reason ? ` Trigger: ${detail.trigger_reason}.` : '';
  sentences.push(`${startedBy(detail.trigger_type)} opened this investigation${when}${dataset}.${reason}`);

  const investigators = new Set(detail.rounds.flatMap((round) => round.agents.map((turn) => turn.agent_id))).size;
  if (investigators > 0) {
    const length = rounds ?? detail.rounds.length;
    const votes = tally(detail);
    sentences.push(
      `${formatCountNoun(investigators, 'investigator')} read their own slices of the logs and debated for ${formatCountNoun(length, 'round')}.${votes ? ` Final votes: ${votes}.` : ''}`,
    );
  }

  if (detail.verdict_class !== null) {
    const confidence = detail.verdict_confidence === null ? '' : ` with an agent-reported confidence of ${formatPercent(detail.verdict_confidence, 1)}`;
    // The same rule the server applies (backend/debate/verdict.py): with no majority the primary investigator decides.
    const tieBreak =
      quorumFromVotes(detail.votes, detail.primary_agent).status === 'primary_decided'
        ? " No class had a majority, so the aggregator's tie-break applied: the class of the primary investigator (the one whose slice holds most of this case's rows) decided it."
        : '';
    sentences.push(
      `The aggregator reached a verdict of ${VERDICT_LABEL[detail.verdict_class]}${confidence}. That is the mean of the supporting agents' self-reported confidence; it is not accuracy.${tieBreak}`,
    );
  } else if (detail.status === 'error') {
    const why = (detail.error_reason ?? 'no reason was recorded').replace(/\.+$/, ''); // the sentence adds its own full stop
    sentences.push(`The debate stopped before a verdict: ${why}.`);
  }

  const citations = detail.citations;
  if (citations.total > 0) {
    const rate = citations.match_rate.value === null ? '' : ` (match rate ${formatPercent(citations.match_rate.value, 1)})`;
    sentences.push(
      `The Watchdog re-checked ${formatCountNoun(citations.total, 'cited value')} against the raw logs: ${formatCount(citations.verified)} verified, ${formatCountNoun(citations.discrepancy, 'discrepancy', 'discrepancies')} and ${formatCountNoun(citations.invalid_row, 'invalid row')}${rate}.`,
    );
  }

  const ran = steps.filter((step) => !step.released);
  if (ran.length > 0) {
    const labels = [...new Set(ran.map((step) => actionLabel(step.actionType).toLowerCase()))].join(', ');
    const first = ran[0].offsetMs;
    const after = first === null ? '' : `, the first ${formatDuration(Math.max(0, first))} after the verdict`;
    sentences.push(`The Self-Healing agent ran ${formatCountNoun(ran.length, 'sandboxed action')} (${labels})${after}. Every action is simulated; nothing reached a real system.`);
  } else if (detail.verdict_class !== null || detail.status === 'error') {
    sentences.push(`Self-Healing: ${healing.label}. ${healing.sentence}`);
  }

  if (timeline !== null && timeline.totalMs !== null) {
    sentences.push(`From acceptance to the last recorded step took ${formatDuration(timeline.totalMs)}${timeline.handsFree ? ', with no analyst action in between' : ''}.`);
  }
  return sentences;
}
