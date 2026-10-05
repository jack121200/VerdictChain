import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

/** Page title: H1 (Space Grotesk 30/36, 36/40 from sm). */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="flex flex-col gap-1">
        <h1 className="font-headline text-h1 tracking-tight text-on-surface sm:text-h1-sm">{title}</h1>
        {subtitle && <div className="text-body text-on-surface-variant">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export interface SectionHeaderProps {
  title: string;
  eyebrow?: string;
  action?: ReactNode;
}

/** Section title: an uppercase label above an H2 (Space Grotesk 18/28). */
export function SectionHeader({ title, eyebrow, action }: SectionHeaderProps) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        {eyebrow && <span className="text-label uppercase text-on-surface-variant">{eyebrow}</span>}
        <h2 className="font-headline text-h2 text-on-surface">{title}</h2>
      </div>
      {action}
    </div>
  );
}
