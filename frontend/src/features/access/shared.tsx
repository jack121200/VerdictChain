/** Small pieces the Access screen parts share. */
import { type ReactNode } from 'react';
import type { Role, ServiceHealth } from '../../api/types';
import { cn } from '../../lib/cn';
import { formatDuration } from '../../lib/format';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icon-names';
import { Metric } from '../../ui/Metric';

export const ROLES: readonly Role[] = ['secops_lead', 'watchdog_supervisor', 'forensic_analyst', 'red_team_auditor'];

export function CardTitle({ icon, iconClass = 'text-primary', children }: { icon: IconName; iconClass?: string; children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 font-headline text-lg font-bold text-on-surface">
      <Icon name={icon} size={20} className={iconClass} />
      <span>{children}</span>
    </h2>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 font-mono text-xs">
      <span className="text-on-surface-variant">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

export function ServiceRow({ label, health }: { label: string; health: ServiceHealth | undefined }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-outline-variant/30 bg-background p-2 font-mono text-xs">
      <span className="inline-flex items-center gap-2 text-on-surface-variant">
        <span
          className={cn('h-2 w-2 rounded-full', health === undefined ? 'bg-outline' : health.ok ? 'bg-secondary animate-pulse' : 'bg-error')}
          aria-hidden="true"
        />
        {label}
      </span>
      <Metric metric={health?.latency_ms} size="body" format={formatDuration} label={`${label} latency`} />
    </div>
  );
}

export function initialsOf(username: string | undefined): string {
  if (!username) return '··';
  const parts = username.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : username.slice(0, 2);
  return letters.toUpperCase();
}
