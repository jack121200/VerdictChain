import { useRef } from 'react';
import { cn } from '../lib/cn';
import { FOCUS_RING } from './classes';

export interface TabItem<T extends string> {
  id: T;
  label: string;
}

export interface TabsProps<T extends string> {
  label: string;
  tabs: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
}

/** Tab strip with arrow-key navigation (roving focus). */
export function Tabs<T extends string>({ label, tabs, value, onChange }: TabsProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function focusAt(index: number) {
    const next = (index + tabs.length) % tabs.length;
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  }

  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 border-b border-outline-variant/40">
      {tabs.map((tab, index) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') focusAt(index + 1);
              if (event.key === 'ArrowLeft') focusAt(index - 1);
            }}
            className={cn(
              '-mb-px cursor-pointer border-b-2 px-3 py-2 text-label font-semibold uppercase transition-colors',
              selected ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface',
              FOCUS_RING,
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
