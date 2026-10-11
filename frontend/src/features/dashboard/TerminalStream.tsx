/** The audit event stream. */
import { useEffect, useRef } from 'react';
import { shortId } from '../../lib/format';
import { type Tone } from '../../ui/classes';
import { CopyHash } from '../../ui/CopyHash';
import { Proof } from '../../ui/Proof';
import { Timestamp } from '../../ui/Timestamp';

// ---- terminal stream --------------------------------------------------------------

export interface TerminalLine {
  key: string;
  /** When the audit entry was recorded, as the API sent it. */
  at: string;
  action: string;
  actor: string;
  investigationId: string | null;
  tone: Tone | 'neutral';
}

export const TERMINAL_TEXT: Record<Tone | 'neutral', string> = {
  neutral: 'text-on-surface-variant',
  primary: 'text-primary',
  secondary: 'text-secondary',
  tertiary: 'text-tertiary',
  error: 'text-error',
};

export function TerminalStream({ lines, onClear, loadedAt }: { lines: readonly TerminalLine[]; onClear: () => void; loadedAt: string | null }) {
  const box = useRef<HTMLDivElement>(null);
  const newestKey = lines.length > 0 ? lines[lines.length - 1].key : null;

  // The newest entry is the last line, so keep it in view whenever the stream changes.
  useEffect(() => {
    const element = box.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines.length, newestKey]);

  return (
    <div className="flex flex-col rounded-xl border border-outline-variant/40 bg-background p-4 shadow-2xl lg:col-span-5">
      <div className="mb-2 flex items-center justify-between border-b border-outline-variant/30 pb-2">
        <div className="flex items-center gap-2">
          <span className="relative inline-flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-2.5 w-2.5 animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
          </span>
          <span className="font-mono text-xs font-semibold uppercase text-on-surface">Audit event stream</span>
          <Proof
            source="GET /audit-trail (tail)"
            n={lines.length}
            asOf={loadedAt}
            label="Audit stream"
            definition="The most recent audit-trail entries, newest last. Clear hides the view only; a refresh restores it. Live WebSocket events appear on the debate room."
          />
        </div>
        <button type="button" onClick={onClear} className="cursor-pointer font-mono text-[10px] text-on-surface-variant hover:text-on-surface">
          CLEAR
        </button>
      </div>

      {/* The box fills whatever height the ledger beside it sets (at least h-64) and scrolls inside, so a long tail never stretches the row. */}
      <div className="relative min-h-64 flex-1">
        <div
          ref={box}
          className="absolute inset-0 space-y-1.5 overflow-y-auto rounded border border-outline-variant/20 bg-surface-container-lowest p-2 font-mono text-[10px]"
        >
          {lines.length === 0 ? (
            <p className="text-on-surface-variant">No audit entries to show.</p>
          ) : (
            lines.map((line) => (
              <div key={line.key} className="leading-relaxed">
                <span className="text-primary">
                  [<Timestamp iso={line.at} mode="clock" />]
                </span>{' '}
                <span className={TERMINAL_TEXT[line.tone]}>
                  {line.action.toUpperCase()} · actor {line.actor}
                  {line.investigationId && (
                    <>
                      {' · inv '}
                      <CopyHash
                        value={line.investigationId}
                        display={shortId(line.investigationId)}
                        label="investigation id"
                        size="inherit"
                        textClassName="text-inherit"
                      />
                    </>
                  )}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
