import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { FOCUS_RING } from './classes';
import { Icon } from './Icon';

export interface ProofInput {
  label: string;
  value: string;
}

export interface ProofProps {
  /** Endpoint or code location the value comes from, for example "/stats" or "api/metrics.py". */
  source: string;
  n: number;
  /** ISO time the value was computed, or null when the source gives none. */
  asOf: string | null;
  definition: string;
  reason?: string | null;
  /** Derived inputs and the formula's operands, for browser-side recomputed values. */
  inputs?: readonly ProofInput[];
  /** Accessible name of the metric or control this popover explains. */
  label?: string;
  className?: string;
}

/** Popover that explains a value: where it comes from, how many rows, when, and the formula. */
export function Proof({ source, n, asOf, definition, reason, inputs, label, className }: ProofProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function onPointerDown(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  return (
    <span ref={wrapperRef} className={cn('relative inline-flex', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label ? `Proof: ${label}` : 'Proof'}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-outline-variant/60 text-on-surface-variant transition-colors hover:border-primary hover:text-primary',
          FOCUS_RING,
        )}
      >
        <Icon name="info" size={12} />
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Proof"
          className="animate-in fade-in absolute right-0 top-full z-40 mt-2 w-80 max-w-[90vw] rounded-xl border border-outline-variant/40 bg-surface-card p-4 text-left text-caption shadow-xl"
        >
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
            <dt className="text-label uppercase text-on-surface-variant">Source</dt>
            <dd className="break-all font-mono text-evidence text-on-surface">{source}</dd>
            <dt className="text-label uppercase text-on-surface-variant">n</dt>
            <dd className="font-mono text-evidence text-on-surface">{n}</dd>
            <dt className="text-label uppercase text-on-surface-variant">As of</dt>
            <dd className="break-all font-mono text-evidence text-on-surface">{asOf ?? 'not reported'}</dd>
            <dt className="text-label uppercase text-on-surface-variant">Definition</dt>
            <dd className="text-on-surface">{definition}</dd>
            {reason && (
              <>
                <dt className="text-label uppercase text-on-surface-variant">Reason</dt>
                <dd className="text-on-surface">{reason}</dd>
              </>
            )}
          </dl>
          {inputs && inputs.length > 0 && (
            <div className="mt-3 border-t border-outline-variant/40 pt-3">
              <p className="text-label uppercase text-on-surface-variant">Derived from</p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                {inputs.map((input) => (
                  <div key={input.label} className="contents">
                    <dt className="text-on-surface-variant">{input.label}</dt>
                    <dd className="break-all font-mono text-evidence text-on-surface">{input.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      )}
    </span>
  );
}
