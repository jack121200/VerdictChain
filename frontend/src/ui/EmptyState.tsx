import type { ReactNode } from 'react';
import { Icon } from './Icon';
import type { IconName } from './icon-names';

export interface EmptyStateProps {
  title: string;
  /** The reason the data is missing, in plain words. Never a placeholder value. */
  description?: string;
  icon?: IconName;
  action?: ReactNode;
}

/** Shown when a list or a metric has nothing to display yet. */
export function EmptyState({ title, description, icon = 'info', action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-outline-variant/60 p-6 text-center">
      <Icon name={icon} size={20} className="text-on-surface-variant" />
      <p className="text-h3 font-headline text-on-surface">{title}</p>
      {description && <p className="max-w-md text-caption text-on-surface-variant">{description}</p>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}
