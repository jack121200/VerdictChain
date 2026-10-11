/**
 * The operations board: what the automation did in the last 24 hours (started by the live monitor, contained with
 * no click, how fast) and the parallel investigation lanes (one per debate slot, running side by side). Every
 * number is a Metric from GET /stats or GET /system/status; the lanes come from the slot holders and the list.
 */
import type { ReactNode } from 'react';
import { buildRoute } from '../../app/router';
import { AGENT_VISUALS } from '../../lib/agents';
import { cn } from '../../lib/cn';
import { formatCount, formatCountNoun, formatDuration, formatPercent, shortId } from '../../lib/format';
import { useNow } from '../../lib/use-now';
import { Card } from '../../ui/Card';
import { CopyButton, CopyHash } from '../../ui/CopyHash';
import { Icon } from '../../ui/Icon';
import { Metric } from '../../ui/Metric';
import { Pill } from '../../ui/Pill';
import { Proof } from '../../ui/Proof';
import { Skeleton } from '../../ui/Skeleton';
import { Timestamp } from '../../ui/Timestamp';
import { buildLanes, type Lane } from './lanes';
import { triggerLabel } from './pipeline';
import { useOperations, type Operations } from './useOperations';

const TONE_GLYPH: Record<string, string> = {
  primary: 'border-primary/40 bg-primary/10 text-primary',
  secondary: 'border-secondary/40 bg-secondary/10 text-secondary',
  tertiary: 'border-tertiary/40 bg-tertiary/10 text-tertiary',
};

function Tile({ label, sub, children }: { label: string; sub: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-outline-variant/40 bg-background p-3">
      <div className="font-mono text-[10px] uppercase text-on-surface-variant">{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">{children}</div>
      <div className="mt-0.5 font-mono text-[10px] text-outline">{sub}</div>
    </div>
  );
}

const seconds = (value: number) => formatDuration(value * 1000);

function Scoreboard({ operations }: { operations: Operations }) {
  const automation = operations.stats.data?.automation;
  const slot = operations.system.data?.debate_slot;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Tile label="Started by the monitor" sub={automation ? `${formatCount(automation.auto_started.value ?? 0)} of ${formatCount(automation.cases.value ?? 0)} cases, 24 h` : 'last 24 hours'}>
        <Metric metric={automation?.auto_share} label="Share of cases started by the live monitor" format={(value) => formatPercent(value, 0)} />
      </Tile>
      <Tile label="Contained hands-free" sub="monitor to sandbox, no click">
        <Metric metric={automation?.hands_free_contained} label="Cases contained with no analyst action" />
      </Tile>
      <Tile label="Median detect → verdict" sub="queue wait included">
        <Metric metric={automation?.median_seconds_to_verdict} label="Median seconds from acceptance to verdict" format={seconds} />
      </Tile>
      <Tile label="Median verdict → contain" sub="to the first sandbox action">
        <Metric metric={automation?.median_seconds_verdict_to_action} label="Median seconds from verdict to first sandbox action" format={seconds} />
      </Tile>
      <Tile label="Debates running" sub="side by side, slots in use">
        <Metric metric={slot?.running} label="Debates running now" />
        <span className="text-caption text-on-surface-variant">of</span>
        <Metric metric={slot?.capacity} label="Debate slots (DEBATE_MAX_CONCURRENT)" />
      </Tile>
    </div>
  );
}

/** One pip per round: done, the round under way, or still to come. */
function RoundPips({ done, total }: { done: number; total: number | null }) {
  const count = total ?? Math.max(done, 1);
  return (
    <div className="flex items-center gap-1" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className={cn('h-1.5 flex-1 rounded-full', index < done ? 'bg-secondary' : index === done ? 'animate-pulse bg-primary' : 'bg-surface-container-highest')} />
      ))}
    </div>
  );
}

function LaneCard({ lane, rounds, now }: { lane: Lane; rounds: number | null; now: number }) {
  if (lane.id === null) {
    return (
      <div className="flex min-h-28 flex-col justify-between rounded-lg border border-dashed border-outline-variant/60 p-3">
        <span className="font-mono text-[10px] uppercase text-on-surface-variant">Lane {lane.number}</span>
        <span className="font-mono text-xs text-outline">Idle · ready for the next flagged window</span>
      </div>
    );
  }
  const item = lane.item;
  const visual = item?.primary_agent ? AGENT_VISUALS[item.primary_agent] : null;
  const done = item?.rounds_complete ?? 0;
  const elapsed = item ? Math.max(0, now - Date.parse(item.created_at)) : null;
  return (
    <div className="relative flex min-h-28 flex-col gap-2 rounded-lg border border-primary/40 bg-surface-card p-3 shadow-glow-cyan">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase text-on-surface-variant">Lane {lane.number}</span>
        {item && <Pill tone={item.trigger_type === 'continuous' ? 'primary' : 'neutral'}>{triggerLabel(item.trigger_type)}</Pill>}
      </div>
      <div className="flex items-center gap-2">
        {visual && <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md border font-mono text-sm', TONE_GLYPH[visual.tone] ?? TONE_GLYPH.primary)}>{visual.glyph}</span>}
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1">
            <a href={buildRoute({ name: 'debate', id: lane.id })} className="font-mono text-sm font-bold text-primary underline" aria-label={`Open the live debate ${shortId(lane.id)}`}>
              {shortId(lane.id)}
            </a>
            <CopyButton value={lane.id} label="investigation id" />
          </span>
          <div className="truncate font-mono text-[10px] text-on-surface-variant">{item?.dataset ?? 'starting'}</div>
        </div>
      </div>
      <RoundPips done={done} total={rounds} />
      <div className="flex items-center justify-between font-mono text-[10px] text-on-surface-variant">
        <span>{item ? (rounds !== null && done >= rounds ? 'verdict and containment' : `round ${Math.min(done + 1, rounds ?? done + 1)}${rounds === null ? '' : ` of ${rounds}`}`) : 'starting'}</span>
        <span>{elapsed === null ? '—' : formatDuration(elapsed)}</span>
      </div>
    </div>
  );
}

export interface OperationsBoardProps {
  /** Debate length from GET /settings, or null while it is not loaded. */
  rounds: number | null;
  /** The Live page shows only the lanes. */
  showScoreboard?: boolean;
}

export function OperationsBoard({ rounds, showScoreboard = true }: OperationsBoardProps) {
  const operations = useOperations(showScoreboard);
  const now = useNow();
  const { system, running, queued } = operations;
  const slot = system.data?.debate_slot;
  const lanes = buildLanes(slot?.capacity.value ?? null, slot?.investigation_ids ?? [], running.data?.items ?? []);
  const waiting = queued.data?.items ?? [];
  const busy = lanes.filter((lane) => lane.id !== null).length;

  return (
    <Card as="section" variant="panel" hairline className="mt-6 space-y-4">
      <div aria-label="Operations board" role="group" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-primary">
              <span className="h-2 w-2 animate-pulse rounded-full bg-primary" aria-hidden="true" />
              Operations board · live
            </span>
            <h2 className="font-headline text-lg font-semibold text-on-surface">Investigations run side by side, with no one clicking</h2>
          </div>
          <Proof
            source="GET /stats.automation · GET /system/status.debate_slot · GET /investigations?status="
            n={busy}
            asOf={system.loadedAt}
            label="Operations board"
            definition="The figures come from GET /stats (automation, last 24 hours: cases the live monitor started, cases it contained with no analyst action, medians of audit-entry differences). A lane is one debate slot (DEBATE_MAX_CONCURRENT); a busy lane is a slot holder from GET /system/status, its progress is the case's rounds_complete from GET /investigations."
          />
        </div>

        {showScoreboard && <Scoreboard operations={operations} />}

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-on-surface-variant">
            <span className="inline-flex items-center gap-1.5 uppercase">
              <Icon name="hub" size={14} className="text-primary" />
              Parallel lanes · {lanes.length > 0 ? `${formatCount(busy)} of ${formatCount(lanes.length)} busy` : 'slots not loaded'}
            </span>
            <span>{waiting.length > 0 ? `${formatCountNoun(waiting.length, 'case')} waiting for a free slot` : 'nothing waiting'}</span>
          </div>

          {system.status === 'loading' ? (
            <Skeleton className="h-28 w-full" />
          ) : system.status === 'failed' ? (
            <p role="alert" className="font-mono text-xs text-error">
              The debate slots could not be read: {system.error}
            </p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-3">
              {lanes.map((lane) => (
                <LaneCard key={lane.number} lane={lane} rounds={rounds} now={now} />
              ))}
            </div>
          )}

          {waiting.length > 0 && (
            <ul aria-label="Cases waiting for a debate slot" className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-on-surface-variant">
              {waiting.slice(0, 6).map((item) => (
                <li key={item.id} className="inline-flex items-center gap-1 rounded border border-outline-variant/40 bg-background px-2 py-0.5">
                  <Icon name="schedule" size={12} />
                  <CopyHash value={item.id} display={shortId(item.id)} label="investigation id" size="inherit" textClassName="text-on-surface" />
                  <Timestamp iso={item.created_at} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
