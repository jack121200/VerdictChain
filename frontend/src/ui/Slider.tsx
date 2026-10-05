import { useId } from 'react';
import { FOCUS_RING } from './classes';

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** Formats the current value for display, for example formatNumber(value, 2). */
  format: (value: number) => string;
  disabled?: boolean;
}

/** Native range input with the value shown next to it. */
export function Slider({ label, value, min, max, step, onChange, format, disabled = false }: SliderProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-body text-on-surface">
          {label}
        </label>
        <output htmlFor={id} className="font-mono text-evidence text-primary">
          {format(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className={`h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-container-highest accent-primary disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
      />
    </div>
  );
}
