/** The inspector of one audit entry, with the browser's own SHA-256 recomputation. */
import { useEffect, useState } from 'react';
import { describeError } from '../../api/client';
import type { AuditEntry } from '../../api/types';
import { cn } from '../../lib/cn';
import { sha256Hex } from '../../lib/derive/hash';
import { formatSeq } from '../../lib/format';
import { CopyButton } from '../../ui/CopyHash';
import { Icon } from '../../ui/Icon';
import { Proof } from '../../ui/Proof';
import { Timestamp } from '../../ui/Timestamp';
import { BoxLabel, humanizeAction } from './shared';

export interface HashCheck {
  computed: string | null;
  match: boolean | null;
  error: string | null;
}

/** Recomputes SHA-256 over the selected entry's hash_input in the browser and checks it against entry_hash. */
export function useHashCheck(entry: AuditEntry): HashCheck {
  const [check, setCheck] = useState<HashCheck>({ computed: null, match: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setCheck({ computed: null, match: null, error: null });
    sha256Hex(entry.hash_input).then(
      (hash) => {
        if (!cancelled) setCheck({ computed: hash, match: hash === entry.entry_hash.toLowerCase(), error: null });
      },
      (cause: unknown) => {
        if (!cancelled) setCheck({ computed: null, match: null, error: describeError(cause) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [entry]);

  return check;
}

export function BrowserRecompute({ entry, check }: { entry: AuditEntry; check: HashCheck }) {
  const { computed, match, error } = check;
  return (
    <div className="space-y-2 rounded-xl border border-outline-variant/40 bg-background p-3.5">
      <BoxLabel
        trailing={
          <Proof
            source="browser: lib/derive/hash.ts sha256Hex(hash_input)"
            n={1}
            asOf={null}
            definition="WebCrypto SHA-256 over the API-supplied hash_input (the exact pre-image). Compared with entry_hash from the same response."
            inputs={[
              { label: 'entry_hash', value: entry.entry_hash },
              { label: 'computed', value: computed ?? 'computing…' },
            ]}
            label="Browser SHA-256 recompute"
          />
        }
      >
        Browser SHA-256 recompute
      </BoxLabel>
      {error ? (
        <p className="flex items-center gap-1.5 font-body text-xs text-error">
          <Icon name="warning" size={12} label="Error" /> {error}
        </p>
      ) : match === null ? (
        <p className="font-body text-xs text-on-surface-variant">Computing…</p>
      ) : (
        <>
          <code className="block break-all font-mono text-[11px] leading-relaxed text-on-surface">{computed}</code>
          {match ? (
            <p className="flex items-center gap-1.5 font-mono text-[11px] font-bold text-secondary">
              <Icon name="verified_user" size={12} label="Match" /> Matches entry_hash
            </p>
          ) : (
            <p className="flex items-center gap-1.5 font-mono text-[11px] font-bold text-error">
              <Icon name="warning" size={12} label="Mismatch" /> Does not match entry_hash
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function EntryInspector({ entry }: { entry: AuditEntry }) {
  const check = useHashCheck(entry);
  return (
    <div className="sticky top-24 space-y-5 rounded-2xl border border-outline-variant/50 bg-surface-container-low p-5 shadow-2xl backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3 border-b border-outline-variant/40 pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold text-primary">seq {formatSeq(entry.seq)}</span>
            {check.match === true && (
              <span className="rounded bg-secondary/20 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-secondary">
                Hash verified in browser
              </span>
            )}
            {check.match === false && (
              <span className="rounded bg-error-container/40 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-error">
                Hash mismatch
              </span>
            )}
          </div>
          <h2 className="mt-1 font-headline text-lg font-bold text-on-surface">{humanizeAction(entry.action)}</h2>
          <p className="mt-0.5 font-mono text-[11px] text-on-surface-variant">
            {entry.actor} · <Timestamp iso={entry.created_at} mode="absolute" />
          </p>
        </div>
        <Icon
          name={check.match === false ? 'warning' : 'verified_user'}
          size={20}
          className={cn('shrink-0', check.match === true ? 'text-secondary' : check.match === false ? 'text-error' : 'text-outline')}
        />
      </div>

      {/* Canonical pre-image the server hashes */}
      <div className="space-y-2 rounded-xl border border-outline-variant/40 bg-background p-3.5">
        <BoxLabel
          trailing={
            <Proof
              source="GET /audit-trail entries[].hash_input"
              n={1}
              asOf={entry.created_at}
              definition="The exact canonical string the server hashes. The browser recomputes SHA-256 over it below."
              label="Hash input"
            />
          }
        >
          Hash input (pre-image)
        </BoxLabel>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded border border-outline-variant/40 bg-surface-container-lowest p-2.5 font-mono text-[11px] leading-relaxed text-primary">
          {entry.hash_input}
        </pre>
      </div>

      {/* Hash chain link: previous and current entry hash */}
      <div className="space-y-2 rounded-xl border border-outline-variant/40 bg-background p-3.5 font-mono text-xs">
        <BoxLabel>Hash chain link</BoxLabel>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-on-surface-variant">Previous entry hash:</span>
          <span className="flex items-start gap-1.5">
            <code className="min-w-0 break-all text-[11px] text-outline">{entry.prev_hash ?? 'none (genesis)'}</code>
            {entry.prev_hash && <CopyButton value={entry.prev_hash} label="previous entry hash" />}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-on-surface-variant">Current entry hash:</span>
          <span className="flex items-start gap-1.5">
            <code className="min-w-0 break-all text-[11px] text-primary">{entry.entry_hash}</code>
            <CopyButton value={entry.entry_hash} label="current entry hash" />
          </span>
        </div>
      </div>

      {/* Honest browser SHA-256 recompute of this entry */}
      <BrowserRecompute entry={entry} check={check} />

      {entry.detail && Object.keys(entry.detail).length > 0 ? (
        <div className="space-y-2 rounded-xl border border-outline-variant/40 bg-background p-3.5">
          <BoxLabel>Detail (canonical, no labels)</BoxLabel>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border border-outline-variant/40 bg-surface-container-lowest p-2.5 font-mono text-[11px] leading-relaxed text-on-surface">
            {JSON.stringify(entry.detail, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
