import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';
import { FOCUS_RING } from './classes';
import { Icon } from './Icon';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * dialog (default): centred, with a title bar and a close button.
   * palette: a wider panel near the top with no title bar (the title stays as the accessible name), for the
   * command palette. Escape, focus return, the focus trap and a click on the scrim work the same in both.
   */
  variant?: 'dialog' | 'palette';
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Dialog. Escape closes it. Focus moves into it when it opens and returns to the opener when it
 * closes. Tab is kept inside the dialog. The top strip is a 4px primary, secondary, primary gradient.
 */
export function Modal({ open, onClose, title, children, footer, variant = 'dialog' }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const firstFocusable = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (firstFocusable ?? panel)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      opener?.focus();
    };
  }, [open]);

  if (!open) return null;
  const palette = variant === 'palette';

  return createPortal(
    <div className={cn('fixed inset-0 z-50 flex justify-center p-4', palette ? 'items-start pt-16 sm:pt-24' : 'items-center')}>
      <div aria-hidden="true" className="animate-in fade-in absolute inset-0 bg-surface-container-lowest/80 backdrop-blur-md" onClick={() => onCloseRef.current()} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'animate-in fade-in slide-in-from-top-4 relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-card shadow-xl focus:outline-none',
          palette ? 'max-w-xl' : 'max-w-lg',
        )}
      >
        <div aria-hidden="true" className="h-1 w-full bg-linear-to-r from-primary via-secondary to-primary" />
        {palette ? (
          <h2 id={titleId} className="sr-only">
            {title}
          </h2>
        ) : (
          <div className="flex items-start justify-between gap-3 border-b border-outline-variant/40 px-5 py-4">
            <h2 id={titleId} className="font-headline text-h2 text-on-surface">
              {title}
            </h2>
            <button
              type="button"
              aria-label="Close dialog"
              onClick={() => onCloseRef.current()}
              className={`cursor-pointer rounded-lg p-1 text-on-surface-variant transition-colors hover:text-primary ${FOCUS_RING}`}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        <div className={palette ? 'flex min-h-0 flex-1 flex-col' : 'overflow-y-auto px-5 py-4'}>{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-outline-variant/40 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
