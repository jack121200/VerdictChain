import type { ReactNode } from 'react';

/** One label and its value on a line of the dossier. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[11px]">
      <span className="shrink-0 text-on-surface-variant">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

/** Inner evidence panel (the reference's darkest inner cards, mapped to the background token). */
export function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-2 rounded-lg border border-outline-variant/40 bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] font-semibold uppercase text-outline">{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}
