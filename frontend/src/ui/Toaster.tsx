import { cn } from '../lib/cn';
import { FOCUS_RING, type Tone } from './classes';
import { Icon } from './Icon';
import type { IconName } from './icon-names';
import { dismissToast, useToasts } from './toast-store';

const TONE_BORDER: Record<Tone, string> = {
  primary: 'border-primary shadow-glow-cyan',
  secondary: 'border-secondary shadow-glow-emerald',
  tertiary: 'border-tertiary shadow-glow-amber',
  error: 'border-error shadow-glow-crimson',
};

const TONE_ICON: Record<Tone, { name: IconName; text: string }> = {
  primary: { name: 'info', text: 'text-primary' },
  secondary: { name: 'check_circle', text: 'text-secondary' },
  tertiary: { name: 'warning', text: 'text-tertiary' },
  error: { name: 'error', text: 'text-error' },
};

/** Stack of toasts, top right. Each one dismisses itself after its duration. */
export function Toaster() {
  const toasts = useToasts();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 top-20 z-50 flex w-80 max-w-[90vw] flex-col gap-2 lg:right-6"
    >
      {toasts.map((toast) => {
        const icon = TONE_ICON[toast.tone];
        return (
          <div
            key={toast.id}
            role="status"
            className={cn(
              'animate-in fade-in slide-in-from-top-4 pointer-events-auto flex items-start gap-3 rounded-xl border bg-background/95 p-3 text-body text-on-surface backdrop-blur-xl',
              TONE_BORDER[toast.tone],
            )}
          >
            <Icon name={icon.name} size={16} className={icon.text} />
            <p className="min-w-0 flex-1 break-words">{toast.message}</p>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismissToast(toast.id)}
              className={cn('cursor-pointer rounded p-0.5 text-on-surface-variant hover:text-on-surface', FOCUS_RING)}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
