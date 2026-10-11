/** The detect, debate, verdict, contain strip on a case card: where the automation has got to for this case. */
import { cn } from '../../lib/cn';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icon-names';
import { Proof } from '../../ui/Proof';
import type { PipelineStage, StageState } from './pipeline';

const DOT: Record<StageState, string> = {
  done: 'border-secondary/60 bg-secondary/15 text-secondary',
  active: 'animate-pulse border-primary bg-primary/20 text-primary',
  pending: 'border-outline-variant text-outline',
  skipped: 'border-outline-variant/60 text-outline',
  failed: 'border-error/60 bg-error-container/30 text-error',
};

const ICON: Record<StageState, IconName> = {
  done: 'check',
  active: 'sync',
  pending: 'schedule',
  skipped: 'block',
  failed: 'cancel',
};

const STATE_WORD: Record<StageState, string> = {
  done: 'done',
  active: 'running',
  pending: 'waiting',
  skipped: 'not needed',
  failed: 'failed',
};

/** The line between two stages is solid once the earlier stage is done. */
function connector(state: StageState): string {
  return state === 'done' ? 'bg-secondary/50' : 'bg-outline-variant/50';
}

export function PipelineStrip({ stages, asOf }: { stages: readonly PipelineStage[]; asOf: string }) {
  return (
    <div className="flex items-start gap-2">
      <ol className="flex min-w-0 flex-1 items-start" aria-label="Automation pipeline of this case">
        {stages.map((stage, index) => (
          <li key={stage.id} className="relative min-w-0 flex-1" aria-label={`${stage.label}: ${stage.detail}, ${STATE_WORD[stage.state]}`}>
            {index < stages.length - 1 && <span aria-hidden="true" className={cn('absolute left-[calc(50%+12px)] right-[calc(-50%+12px)] top-2.5 h-px', connector(stage.state))} />}
            <div className="flex flex-col items-center gap-0.5 text-center">
              <span className={cn('flex h-5 w-5 items-center justify-center rounded-full border', DOT[stage.state])}>
                <Icon name={ICON[stage.state]} size={12} />
              </span>
              <span className="font-mono text-[9px] uppercase text-on-surface-variant">{stage.label}</span>
              <span className={cn('max-w-full truncate font-mono text-[10px]', stage.state === 'failed' ? 'text-error' : 'text-on-surface')}>{stage.detail}</span>
            </div>
          </li>
        ))}
      </ol>
      <Proof
        source="GET /investigations (status, trigger_type, rounds_complete, verdict_class, containment_count)"
        n={1}
        asOf={asOf}
        label="Automation pipeline"
        definition="Four stages worked out from the case's own list fields. Detect: who started it (the live monitor starts continuous cases). Debate: rounds done out of the debate length in GET /settings. Verdict: the class once the debate ends. Contain: the number of sandbox action rows; 'no action' when the verdict plans none."
      />
    </div>
  );
}
