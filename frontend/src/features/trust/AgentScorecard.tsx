/** One investigator's credibility scorecard. */
import type { FleetEntry } from '../../api/types';
import { AGENT_VISUALS, INVESTIGATOR_VISUALS } from '../../lib/agents';
import { cn } from '../../lib/cn';
import { cssPercent, formatMaybeCount, formatPercent, formatSignedPercent } from '../../lib/format';
import { Metric } from '../../ui/Metric';
import { Proof } from '../../ui/Proof';
import { VERDICT_LABEL } from '../investigations/labels';
import { TONE_BAR } from './shared';

export const TONE_TEXT: Record<'primary' | 'secondary' | 'tertiary', string> = {
  primary: 'text-primary',
  secondary: 'text-secondary',
  tertiary: 'text-tertiary',
};
export const TONE_BOX: Record<'primary' | 'secondary' | 'tertiary', string> = {
  primary: 'border-primary/30 text-primary',
  secondary: 'border-secondary/30 text-secondary',
  tertiary: 'border-tertiary/30 text-tertiary',
};

// ---- Section 2: agent scorecards -----------------------------------------------

export function AgentScorecard({
  agent,
  delta,
  flagged,
  asOf,
}: {
  agent: FleetEntry;
  delta: number | null;
  flagged: boolean;
  asOf: string | null;
}) {
  const tone = INVESTIGATOR_VISUALS[agent.agent_id].tone;
  const crs = agent.crs.value;
  const statusLabel = agent.isolated ? 'Quarantined' : flagged ? 'Flagged // desync' : 'Synchronized';
  const statusClass = agent.isolated
    ? 'bg-error-container/40 text-error border-error/40'
    : flagged
      ? 'bg-tertiary/15 text-tertiary border-tertiary/30'
      : 'bg-secondary/10 text-secondary border-secondary/30';
  const borderClass = flagged ? 'border-tertiary/40' : agent.isolated ? 'border-error/40' : 'border-outline-variant/40';

  return (
    <div className={cn('rounded-xl border bg-surface-container-low p-4 shadow-md transition-all hover:bg-surface-card', borderClass)}>
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg border bg-surface-container-high font-mono text-lg', TONE_BOX[tone])}>
            {AGENT_VISUALS[agent.agent_id].glyph}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-headline text-base font-semibold text-on-surface">{agent.display_name}</span>
              <span className={cn('rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase', statusClass)}>
                {statusLabel}
              </span>
              <Proof
                source="GET /agents/fleet"
                n={agent.rounds_scored.value ?? 0}
                asOf={asOf}
                definition="CrS, verified/total citations, invalid-citation rate and last vote class for this investigator. The change shown is its most-recent scored-round movement (crs_after − crs_before). Model and provider chain are read from config."
                label={`${agent.display_name} scorecard`}
              />
            </div>
            <span className="font-mono text-[10px] text-on-surface-variant">
              {agent.model ?? 'model not configured'}
              {agent.provider_chain.length > 0 && ` · ${agent.provider_chain.join(' → ')}`}
            </span>
          </div>
        </div>
        <div className="flex items-baseline gap-1 font-mono sm:text-right">
          <Metric size="body" className={TONE_TEXT[tone]} label={`Credibility, ${agent.display_name}`} metric={agent.crs} format={(value) => formatPercent(value, 1)} />
          {delta !== null && (
            <span className={cn('ml-1 text-[10px] font-semibold', delta >= 0 ? 'text-secondary' : 'text-error')}>{formatSignedPercent(delta)}</span>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high">
          <div className={cn('h-full rounded-full', TONE_BAR[tone])} style={{ width: cssPercent(crs ?? 0) }} />
        </div>
        <div className="grid grid-cols-3 gap-2 pt-1 font-mono text-xs">
          <div>
            <span className="block text-[10px] uppercase text-on-surface-variant">Verified citations</span>
            <span className="font-semibold text-on-surface">
              {formatMaybeCount(agent.citations_verified.value)} / {formatMaybeCount(agent.citations_total.value)}
            </span>
          </div>
          <div>
            <span className="block text-[10px] uppercase text-on-surface-variant">Invalid citation rate</span>
            <span className="inline-flex items-center gap-1">
              <Metric size="body" className={tone === 'tertiary' ? 'text-tertiary' : 'text-secondary'} label={`Invalid-citation rate, ${agent.display_name}`} metric={agent.invalid_rate} format={(value) => formatPercent(value, 1)} />
            </span>
          </div>
          <div>
            <span className="block text-[10px] uppercase text-on-surface-variant">Last vote class</span>
            <span className="font-semibold text-on-surface">{agent.last_vote === null ? 'no vote yet' : VERDICT_LABEL[agent.last_vote]}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
