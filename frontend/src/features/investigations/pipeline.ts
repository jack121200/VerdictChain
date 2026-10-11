/**
 * The four stages every case moves through, for the strip on each case card: detect, debate, verdict, contain.
 * A pure function of the case's list fields (status, trigger, rounds done, verdict, action count); nothing is typed
 * in. The Proof on the strip says so.
 */
import type { InvestigationStatus, InvestigationSummary } from '../../api/types';
import { formatCountNoun } from '../../lib/format';
import { VERDICT_LABEL } from './labels';

export type StageId = 'detect' | 'debate' | 'verdict' | 'contain';
export type StageState = 'done' | 'active' | 'pending' | 'skipped' | 'failed';

export interface PipelineStage {
  id: StageId;
  label: string;
  state: StageState;
  /** The short fact under the stage: who detected it, rounds done, the class, how many actions. */
  detail: string;
}

const FINISHED: ReadonlySet<InvestigationStatus> = new Set(['verdict_reached', 'contained', 'ambiguous']);

/** Who started the case, in words: the live monitor starts `continuous` cases, an analyst the others. */
export function triggerLabel(triggerType: string): string {
  if (triggerType === 'continuous') return 'live monitor';
  if (triggerType === 'manual') return 'analyst';
  return triggerType;
}

type PipelineInput = Pick<InvestigationSummary, 'status' | 'trigger_type' | 'rounds_complete' | 'verdict_class' | 'containment_count'>;

/** `rounds` is the debate length from GET /settings; null (not loaded) shows the rounds done without a total. */
export function casePipeline(item: PipelineInput, rounds: number | null): PipelineStage[] {
  const finished = FINISHED.has(item.status);
  const failed = item.status === 'error';
  const waiting = item.status === 'queued';
  const debateDone = finished || (rounds !== null && item.rounds_complete >= rounds);
  const roundsText = rounds === null ? formatCountNoun(item.rounds_complete, 'round') : `${item.rounds_complete}/${rounds}`;
  const acted = item.containment_count > 0;

  return [
    { id: 'detect', label: 'Detect', state: 'done', detail: triggerLabel(item.trigger_type) },
    {
      id: 'debate',
      label: 'Debate',
      state: waiting ? 'pending' : debateDone ? 'done' : failed ? 'failed' : 'active',
      detail: waiting ? 'queued' : roundsText,
    },
    {
      id: 'verdict',
      label: 'Verdict',
      state: finished ? 'done' : failed ? 'failed' : 'pending',
      detail: item.verdict_class !== null ? VERDICT_LABEL[item.verdict_class] : failed ? 'none' : '—',
    },
    {
      id: 'contain',
      label: 'Contain',
      state: acted ? 'done' : finished || failed ? 'skipped' : 'pending',
      detail: acted ? formatCountNoun(item.containment_count, 'action') : finished ? 'no action' : '—',
    },
  ];
}
