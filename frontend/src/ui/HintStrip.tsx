import { useState } from 'react';
import { cn } from '../lib/cn';
import { FOCUS_RING } from './classes';
import { Icon } from './Icon';

const STORAGE_PREFIX = 'vc-hint-dismissed:';

function isDismissed(pageId: string): boolean {
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + pageId) === '1';
  } catch {
    // Storage blocked (private window, cleared site data): the hint simply shows on every visit.
    return false;
  }
}

function remember(pageId: string, dismissed: boolean): void {
  try {
    if (dismissed) window.localStorage.setItem(STORAGE_PREFIX + pageId, '1');
    else window.localStorage.removeItem(STORAGE_PREFIX + pageId);
  } catch {
    // Not saved. The choice still holds until the page is closed.
  }
}

export interface HintStripProps {
  /** Stable name of the page. The dismissal is remembered under it, so each page keeps its own choice. */
  pageId: string;
  /** Two or three true sentences: how to read the page and where its numbers come from. */
  sentences: readonly string[];
  className?: string;
}

/**
 * A short, dismissible "how to read this page" note. Dismissal is remembered per page in localStorage; every
 * storage access is guarded, so the page renders the same without it. A dismissed hint leaves one small
 * button behind that brings it back, so the note is never lost for good.
 */
export function HintStrip({ pageId, sentences, className }: HintStripProps) {
  const [dismissed, setDismissed] = useState(() => isDismissed(pageId));

  function change(next: boolean) {
    setDismissed(next);
    remember(pageId, next);
  }

  if (dismissed) {
    return (
      <div className={cn('flex justify-end', className)}>
        <button
          type="button"
          onClick={() => change(false)}
          className={cn(
            'inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-caption text-on-surface-variant transition-colors hover:text-primary',
            FOCUS_RING,
          )}
        >
          <Icon name="info" size={12} />
          Show how to read this page
        </button>
      </div>
    );
  }

  return (
    <section
      aria-label="How to read this page"
      className={cn('flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3', className)}
    >
      <Icon name="info" size={16} className="mt-0.5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-label uppercase tracking-wider text-primary">How to read this page</p>
        <p className="text-caption leading-relaxed text-on-surface-variant">{sentences.join(' ')}</p>
      </div>
      <button
        type="button"
        aria-label="Dismiss how-to-read hint"
        onClick={() => change(true)}
        className={cn('shrink-0 cursor-pointer rounded-lg p-1 text-on-surface-variant transition-colors hover:text-primary', FOCUS_RING)}
      >
        <Icon name="close" size={16} />
      </button>
    </section>
  );
}
