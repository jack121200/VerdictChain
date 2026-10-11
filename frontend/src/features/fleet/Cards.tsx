/** The selectable cards of the Fleet screen: one per investigator and one per service. */
import { type ReactNode } from 'react';
import type { FleetEntry } from '../../api/types';
import { cn } from '../../lib/cn';
import { cssPercent, formatMaybeCount } from '../../lib/format';
import { Icon } from '../../ui/Icon';
import { Avatar, Figure, SelectCard, ServiceKey, percent } from './shared';

export function AgentCard({ agent, selected, onSelect }: { agent: FleetEntry; selected: boolean; onSelect: () => void }) {
  const isolated = agent.isolated;
  return (
    <SelectCard label={`Select ${agent.display_name}`} selected={selected} onSelect={onSelect} className={isolated ? 'opacity-60' : ''}>
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <Avatar agentId={agent.agent_id} />
            <div>
              <div className="font-headline text-base font-bold text-on-surface">{agent.display_name}</div>
              <div className="font-mono text-[10px] text-primary">{agent.domain}</div>
            </div>
          </div>
          <span
            className={cn(
              'rounded border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider',
              isolated ? 'border-error/40 bg-error-container/40 text-error' : 'border-secondary/40 bg-secondary-container/20 text-secondary',
            )}
          >
            {isolated ? 'Quarantined' : 'Active'}
          </span>
        </div>
        <p className="mt-3 line-clamp-2 font-body text-xs text-on-surface-variant">{agent.signals.join(', ')}</p>
      </div>

      <div className="mt-4 space-y-2 border-t border-outline-variant/30 pt-3">
        <div className="flex items-center justify-between font-mono text-xs">
          <span className="text-outline">Credibility:</span>
          <Figure metric={agent.crs} tone="text-secondary" format={percent} label={`Credibility, ${agent.display_name}`} className="font-bold" />
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-background">
          <div
            className={cn('h-full rounded-full', agent.crs.value === null ? '' : 'bg-linear-to-r from-primary-container to-secondary')}
            style={{ width: cssPercent(agent.crs.value ?? 0) }}
          />
        </div>
        <div className="flex items-center justify-between font-mono text-[10px] text-on-surface-variant">
          <span>
            Last vote: <strong className="text-on-surface">{agent.last_vote ?? 'none'}</strong>
          </span>
          <span>
            Citations: <strong className="text-on-surface">{formatMaybeCount(agent.citations_verified.value)}/{formatMaybeCount(agent.citations_total.value)}</strong>
          </span>
        </div>
      </div>
    </SelectCard>
  );
}

export function ServiceCard({
  agentId,
  name,
  domain,
  selected,
  onSelect,
  children,
}: {
  agentId: ServiceKey;
  name: string;
  domain: string;
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <SelectCard label={`Select ${name}`} selected={selected} onSelect={onSelect}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <Avatar agentId={agentId} />
          <div>
            <div className="flex items-center gap-1.5 font-headline text-base font-bold text-on-surface">
              {name}
              {agentId === 'watchdog' ? <Icon name="verified_user" size={16} className="text-secondary" /> : null}
            </div>
            <div className="font-mono text-[10px] text-primary">{domain}</div>
          </div>
        </div>
        <span className="rounded border border-primary-container/40 bg-on-primary-container px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-secondary">
          Service
        </span>
      </div>
      <div className="mt-4 space-y-2 border-t border-outline-variant/30 pt-3">{children}</div>
    </SelectCard>
  );
}
