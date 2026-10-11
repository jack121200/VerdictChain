import { useId } from 'react';
import { CONTROL_BORDER, FOCUS_RING } from './classes';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export interface SelectProps<T extends string> {
  label: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}

/** Native select. Options are typed, so an unknown value cannot reach onChange. */
export function Select<T extends string>({ label, value, options, onChange, disabled = false }: SelectProps<T>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label uppercase text-on-surface-variant">
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const next = options.find((option) => option.value === event.target.value);
          if (next) onChange(next.value);
        }}
        className={`cursor-pointer rounded-lg ${CONTROL_BORDER} bg-surface-container-low px-3 py-2 text-body text-on-surface disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
