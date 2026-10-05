import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { FOCUS_RING } from './classes';
import { Icon } from './Icon';

export interface CopyHashProps {
  /** The full value, copied as is. */
  value: string;
  /** What the value is, for screen readers and the copy button. */
  label: string;
  className?: string;
}

/** Hash or id in evidence type with a copy button. The full value stays in the title and in the copy. */
export function CopyHash({ value, label, className }: CopyHashProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const short = value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;

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
    <span className={cn('inline-flex max-w-full items-center gap-1.5 font-mono text-evidence text-on-surface', className)}>
      <span title={value} aria-label={`${label}: ${value}`} className="truncate">
        {short}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className={cn('cursor-pointer rounded p-0.5 text-on-surface-variant transition-colors hover:text-primary', FOCUS_RING)}
      >
        <Icon name={copied ? 'check' : 'content_copy'} size={12} />
      </button>
      {copied && <span className="text-caption text-secondary">Copied</span>}
    </span>
  );
}
