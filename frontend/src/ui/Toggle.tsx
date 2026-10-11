import { useId } from 'react';
import { cn } from '../lib/cn';
import { FOCUS_RING } from './classes';

export interface ToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** On/off switch. Every toggle must have a real action behind it (plan R8). */
export function Toggle({ label, description, checked, onChange, disabled = false }: ToggleProps) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col">
        <label htmlFor={id} className="text-body text-on-surface">
          {label}
        </label>
        {description && <span className="text-caption text-on-surface-variant">{description}</span>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'border-primary bg-primary-container' : 'border-outline bg-surface-container-highest',
          FOCUS_RING,
        )}
      >
        <span
          className={cn(
            'inline-block h-4 w-4 transform rounded-full transition-transform',
            checked ? 'translate-x-6 bg-on-primary' : 'translate-x-1 bg-on-surface-variant',
          )}
        />
      </button>
    </div>
  );
}
