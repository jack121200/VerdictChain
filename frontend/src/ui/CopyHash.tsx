import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { FOCUS_RING } from './classes';
import { Icon } from './Icon';

export interface CopyButtonProps {
  /** The full value, copied as is. */
  value: string;
  /** What the value is, for screen readers: the button reads "Copy <label>". */
  label: string;
}

/**
 * Just the copy button, for a hash or id that is already on screen (as a link, say). It confirms with "Copied".
 * It is positioned, so inside a card whose select button covers it, it paints above that button and stays clickable.
 */
export function CopyButton({ value, label }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <span className="relative inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          void copy();
        }}
        aria-label={`Copy ${label}`}
        className={cn('cursor-pointer rounded p-0.5 text-on-surface-variant transition-colors hover:text-primary', FOCUS_RING)}
      >
        <Icon name={copied ? 'check' : 'content_copy'} size={12} />
      </button>
      {copied && <span className="text-caption text-secondary">Copied</span>}
    </span>
  );
}

export interface CopyHashProps {
  /** The full value, copied as is. */
  value: string;
  /** What the value is, for screen readers and the copy button. */
  label: string;
  /** Text to show instead of the default first-10 … last-6 form, for example the 8-character case id. */
  display?: string;
  /** Colour and weight of the shown text. Defaults to text-on-surface. */
  textClassName?: string;
  /** evidence (default): JetBrains Mono 12/16. inherit: size and line height come from the surrounding text. */
  size?: 'evidence' | 'inherit';
  className?: string;
}

/**
 * Hash or id in evidence type with a copy button. The full value stays in the title and in the copy.
 * Use it wherever a hash or an id is shown shortened, so the full value is one click away.
 */
export function CopyHash({ value, label, display, textClassName = 'text-on-surface', size = 'evidence', className }: CopyHashProps) {
  const short = display ?? (value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value);
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1.5 font-mono', size === 'evidence' && 'text-evidence', className)}>
      <span title={value} aria-label={`${label}: ${value}`} className={cn('truncate', textClassName)}>
        {short}
      </span>
      <CopyButton value={value} label={label} />
    </span>
  );
}
