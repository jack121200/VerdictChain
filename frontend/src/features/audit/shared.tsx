/** Small pieces the Audit screen parts share. */
import { type ReactNode } from 'react';
import { cn } from '../../lib/cn';

/** Presentation label for an audit action code: a pure function of the API field. */
export function humanizeAction(action: string): string {
  const base = action.startsWith('release:') ? `release ${action.slice('release:'.length)}` : action;
  return base.replace(/[_:]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function HudTile({ label, children, sub, subTone }: { label: string; children: ReactNode; sub: ReactNode; subTone?: string }) {
  return (
    <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low/80 p-4 backdrop-blur-md">
      <div className="font-mono text-[10px] uppercase text-on-surface-variant">{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-2">{children}</div>
      <div className={cn('mt-1 font-mono text-[10px]', subTone ?? 'text-on-surface-variant')}>{sub}</div>
    </div>
  );
}

export function BoxLabel({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="flex items-center justify-between font-mono text-[10px] font-semibold uppercase text-outline">
      <span>{children}</span>
      {trailing}
    </div>
  );
}
