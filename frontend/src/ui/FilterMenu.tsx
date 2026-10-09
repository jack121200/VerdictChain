import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { FOCUS_RING } from './classes';
import { Icon } from './Icon';
import { Proof, type ProofProps } from './Proof';
import { Select, type SelectOption } from './Select';

export interface FilterGroup {
  id: string;
  label: string;
  value: string;
  /** The first option is the "no filter" choice; any other value counts as an active filter. */
  options: readonly SelectOption<string>[];
  onChange: (value: string) => void;
  /** One true line about the chosen option, shown under the control. */
  hint?: string | null;
}

export interface FilterMenuProps {
  groups: readonly FilterGroup[];
  /** Resets every group to its first option. */
  onClear: () => void;
  /** Proof for the control: which query parameters the filters become. */
  proof: Omit<ProofProps, 'label' | 'className'>;
  className?: string;
}

/** How many groups are set to something other than their first ("all") option. */
export function activeFilterCount(groups: readonly FilterGroup[]): number {
  return groups.filter((group) => group.options.length > 0 && group.value !== group.options[0].value).length;
}

/**
 * One "Filters" button that opens a small panel of selects. The badge counts the active filters. Escape closes
 * the panel and returns focus to the button; a click outside closes it too. Each change is applied at once.
 */
export function FilterMenu({ groups, onClear, proof, className }: FilterMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const active = activeFilterCount(groups);

  // Move focus to the first control when the panel opens, so the keyboard can start right away.
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>('select, button')?.focus();
  }, [open]);

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
    <div ref={wrapperRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={active > 0 ? `Filters, ${active} active` : 'Filters'}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 font-mono text-xs uppercase transition-colors',
          active > 0
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'border-outline-variant/50 bg-background text-on-surface-variant hover:text-on-surface',
          FOCUS_RING,
        )}
      >
        <Icon name="tune" size={16} />
        <span>Filters</span>
        {active > 0 && (
          <span
            aria-hidden="true"
            className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary-container px-1.5 text-label font-bold text-on-primary"
          >
            {active}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="Filters"
          className="animate-in fade-in absolute right-0 top-full z-40 mt-2 w-80 max-w-[90vw] space-y-4 rounded-xl border border-outline-variant/40 bg-surface-card p-4 shadow-xl"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-label uppercase text-on-surface-variant">
              Filters
              <Proof {...proof} label="Filters" />
            </span>
            <button
              type="button"
              onClick={onClear}
              disabled={active === 0}
              className={cn(
                'cursor-pointer rounded-lg px-2 py-1 text-caption text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:text-outline disabled:hover:bg-transparent',
                FOCUS_RING,
              )}
            >
              Clear
            </button>
          </div>

          {groups.map((group) => (
            <div key={group.id} className="space-y-1">
              <Select label={group.label} value={group.value} options={group.options} onChange={group.onChange} />
              {group.hint && <p className="text-caption text-on-surface-variant">{group.hint}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
