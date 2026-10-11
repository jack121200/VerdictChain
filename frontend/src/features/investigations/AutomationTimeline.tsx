/** The automation timeline of one case: queue, rounds, verdict and containment, each measured from audit entries. */
import { cn } from '../../lib/cn';
import { formatClock, formatDuration } from '../../lib/format';
import { Icon } from '../../ui/Icon';
import { Pill } from '../../ui/Pill';
import { Proof } from '../../ui/Proof';
import { Skeleton } from '../../ui/Skeleton';
import { triggerLabel } from './pipeline';
import type { CaseTimeline, StepKind, TimelineStep } from './timeline';

const BAR: Record<StepKind, string> = {
  queue: 'bg-outline',
  round: 'bg-primary/70',
  verdict: 'bg-secondary',
  contain: 'bg-error/80',
  failed: 'bg-error',
};

/** A step with no duration (the verdict) still needs a visible marker; it gets this share of the bar. */
const POINT_SHARE = 0.03;
/** No segment is narrower than this share, so a short round stays readable beside a long one. */
const MIN_SHARE = 0.06;

function weightOf(step: TimelineStep, total: number): number {
  return Math.max(step.durationMs, total * (step.durationMs === 0 ? POINT_SHARE : MIN_SHARE));
}

export interface AutomationTimelineProps {
  /** null while the audit entries are loading. */
  timeline: CaseTimeline | null;
  error?: string;
  triggerType: string | null;
  loadedAt: string | null;
}

export function AutomationTimeline({ timeline, error, triggerType, loadedAt }: AutomationTimelineProps) {
  const total = timeline?.totalMs ?? 0;
  const proof = (
    <Proof
      source="GET /audit-trail?investigation_id= (created_at of each entry)"
      n={timeline?.entryCount ?? 0}
      asOf={loadedAt}
      label="Automation timeline"
      definition="Every instant is the created_at of one of this case's audit entries: investigation_started (accepted), debate_started (a debate slot was free), round_completed (one per round), verdict_reached, and the sandbox action entries. A duration is the difference of two of those stored timestamps. Hands-free: the live monitor started the case and no person appears among the actors of the entries up to the last step; feedback or a sign-off afterwards does not count against it."
      inputs={[
        { label: 'accepted at', value: timeline?.startedAt ?? 'not recorded' },
        { label: 'actors', value: timeline && timeline.actors.length > 0 ? timeline.actors.join(', ') : 'none' },
      ]}
    />
  );

  return (
    <section aria-label="Automation timeline" className="space-y-3 rounded-lg border border-outline-variant/40 bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] font-semibold uppercase text-outline">Automation timeline</span>
        <span className="inline-flex items-center gap-1.5">
          {timeline && timeline.steps.length > 0 && (
            timeline.handsFree ? (
              <Pill tone="secondary" icon="bolt">Hands-free · no analyst action</Pill>
            ) : timeline.people.length > 0 ? (
              <Pill tone="neutral" icon="badge">{triggerLabel(triggerType ?? '')} · {timeline.people.join(', ')}</Pill>
            ) : null
          )}
          {proof}
        </span>
      </div>

      {timeline === null ? (
        error ? <p className="font-mono text-[11px] text-on-surface-variant">— {error}</p> : <Skeleton className="h-16 w-full" />
      ) : timeline.steps.length === 0 ? (
        <p className="font-mono text-[11px] text-on-surface-variant">No audit entries to measure yet.</p>
      ) : (
        <>
          <p className="font-mono text-[11px] text-on-surface-variant">
            Accepted <span className="text-on-surface">{timeline.startedAt ? formatClock(timeline.startedAt) : '—'}</span> · every step{' '}
            <span className="text-on-surface">{formatDuration(total)}</span> end to end
          </p>

          <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded" role="img" aria-label={`Timeline of ${timeline.steps.length} steps over ${formatDuration(total)}`}>
            {timeline.steps.map((step) => (
              <span key={step.id} title={`${step.label}${step.durationMs > 0 ? ` · ${formatDuration(step.durationMs)}` : ''}`} className={cn('h-full rounded-sm', BAR[step.kind])} style={{ flexGrow: weightOf(step, total), flexBasis: 0 }} />
            ))}
          </div>

          <ol className="space-y-1">
            {timeline.steps.map((step) => (
              <li key={step.id} className="flex items-center gap-2 font-mono text-[11px]">
                <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full', BAR[step.kind])} />
                <span className="w-24 shrink-0 text-on-surface">{step.label}</span>
                <span className="min-w-0 flex-1 truncate text-on-surface-variant">{step.detail ?? ''}</span>
                <span className="shrink-0 text-on-surface-variant">{step.durationMs > 0 ? formatDuration(step.durationMs) : <Icon name="check" size={12} />}</span>
                <span className="w-16 shrink-0 text-right text-outline">+{formatDuration(step.endMs)}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
