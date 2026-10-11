/** One gauge per monitored window, with the rule that flags it. */
import { type ReactNode } from 'react';
import type { LiveWindow } from '../../api/types';
import { cn } from '../../lib/cn';
import { formatCount, formatNumber } from '../../lib/format';
import { Card } from '../../ui/Card';
import { Pill } from '../../ui/Pill';
import { Proof } from '../../ui/Proof';
import { FLAG_SUSPICION, RULE_DEFINITION, fillRatio, thresholdLabel, valueLabel, windowState } from './derive';

export function Tile({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low/80 p-4 backdrop-blur-md">
      <div className="font-mono text-[10px] uppercase text-on-surface-variant">{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-2">{children}</div>
      {sub && <div className="mt-1 font-mono text-[10px] text-on-surface-variant">{sub}</div>}
    </div>
  );
}

/** One source group: how full its window is, the number the rule looks at, and whether it flagged. */
export function WindowCard({ window: win, loadedAt }: { window: LiveWindow; loadedAt: string | null }) {
  const state = windowState(win);
  const tone = state === 'flagged' ? 'error' : state === 'normal' ? 'secondary' : 'neutral';
  return (
    <Card hoverTone={state === 'flagged' ? 'error' : undefined} className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <span className="font-headline text-body font-semibold text-on-surface">{win.source}</span>
          <span className="font-mono text-[10px] text-on-surface-variant">{win.feature}</span>
        </div>
        <Pill tone={tone} icon={state === 'flagged' ? 'warning' : state === 'normal' ? 'check' : 'sync'}>
          {state === 'flagged' ? 'Flagged' : state === 'normal' ? 'Normal' : 'Filling'}
        </Pill>
      </div>

      <div className="flex items-center gap-2">
        <div
          role="meter"
          aria-label={`Suspicion, ${win.source}`}
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={Math.round(win.suspicion * 100) / 100}
          className="relative h-2 w-full overflow-hidden rounded-full bg-surface-container-highest"
        >
          <div
            className={cn('h-full rounded-full', state === 'flagged' ? 'bg-error' : 'bg-linear-to-r from-primary-container to-secondary')}
            style={{ width: `${win.suspicion * 100}%` }}
          />
          <div aria-hidden="true" className="absolute inset-y-0 w-px bg-on-surface-variant" style={{ left: `${FLAG_SUSPICION * 100}%` }} />
        </div>
        <span className="font-mono text-evidence tabular-nums text-on-surface">{formatNumber(win.suspicion, 2)}</span>
        <Proof
          source="GET /live/status (windows)"
          n={win.scored_rows}
          asOf={loadedAt}
          label={`Suspicion, ${win.source}`}
          definition={RULE_DEFINITION[win.group]}
          inputs={[
            { label: 'window rows', value: `${win.rows} of ${win.size}` },
            { label: valueLabel(win.group), value: win.value === null ? '—' : formatNumber(win.value, 3) },
            { label: thresholdLabel(win.group), value: win.threshold === null ? '—' : formatNumber(win.threshold, 3) },
            { label: 'z', value: win.z === null ? '—' : formatNumber(win.z, 1) },
          ]}
        />
      </div>

      <dl className="grid grid-cols-3 gap-2 font-mono text-[10px] text-on-surface-variant">
        <div>
          <dt className="uppercase">window</dt>
          <dd className="text-evidence text-on-surface tabular-nums">
            {formatCount(win.rows)} / {formatCount(win.size)}
          </dd>
        </div>
        <div>
          <dt className="uppercase">{valueLabel(win.group)}</dt>
          <dd className="text-evidence text-on-surface tabular-nums">{win.value === null ? '—' : formatNumber(win.value, 2)}</dd>
        </div>
        <div>
          <dt className="uppercase">{thresholdLabel(win.group)}</dt>
          <dd className="text-evidence text-on-surface tabular-nums">{win.threshold === null ? '—' : formatNumber(win.threshold, 2)}</dd>
        </div>
      </dl>
      <p className="text-caption text-on-surface-variant">{win.rule}</p>
      <div className="h-0.5 w-full overflow-hidden rounded-full bg-surface-container-highest" aria-hidden="true">
        <div className="h-full bg-outline" style={{ width: `${fillRatio(win) * 100}%` }} />
      </div>
    </Card>
  );
}
