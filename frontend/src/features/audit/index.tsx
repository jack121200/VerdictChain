import { useMemo, useState } from 'react';
import { describeError, listAuditTrail, verifyAuditTrail } from '../../api/client';
import type { AuditVerifyResult } from '../../api/types';
import { useAsync } from '../../app/use-async';
import { cn } from '../../lib/cn';
import { formatCount, formatSeq, shortId } from '../../lib/format';
import { FOCUS_RING } from '../../ui/classes';
import { CopyHash } from '../../ui/CopyHash';
import { EmptyState } from '../../ui/EmptyState';
import { HintStrip } from '../../ui/HintStrip';
import { Icon } from '../../ui/Icon';
import { Proof } from '../../ui/Proof';
import { Tabs } from '../../ui/Tabs';
import { Timestamp } from '../../ui/Timestamp';
import { pushToast } from '../../ui/toast-store';
import { exportCustodyBundle } from './custody';
import { HudTile, humanizeAction } from './shared';
import { ContainmentTab } from './ContainmentTab';
import { EntryInspector } from './EntryInspector';

type AuditTab = 'ledger' | 'containment';

const HINT = [
  'Each audit entry stores the SHA-256 hash of its own contents and the hash of the entry before it, so changing any past entry breaks every hash after it: the chain is tamper-evident, not tamper-proof.',
  'Select an entry to see the exact text that was hashed; your browser recomputes its SHA-256 and compares it with the stored hash, and Verify runs the same check for the whole chain on the server.',
  'Entries come from GET /audit-trail, newest first; the Containment tab lists the sandbox actions from GET /response-actions.',
] as const;

export default function AuditPage() {
  const trail = useAsync(() => listAuditTrail({ limit: 50 }), 30_000, ['audit']);
  const [tab, setTab] = useState<AuditTab>('ledger');
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);
  const [verifyResult, setVerifyResult] = useState<AuditVerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);

  const entries = trail.data?.entries ?? [];
  const chain = trail.data?.chain;
  const selected = useMemo(() => entries.find((entry) => entry.seq === selectedSeq) ?? entries[0], [entries, selectedSeq]);

  async function runVerify(): Promise<void> {
    setVerifying(true);
    try {
      const result = await verifyAuditTrail({ full: true });
      setVerifyResult(result);
      pushToast(
        result.chain_valid
          ? `Server verify: ${formatCount(result.entries_checked)} entries intact.`
          : `Server verify: chain break at seq ${result.first_break_seq ?? '?'}.`,
        { tone: result.chain_valid ? 'secondary' : 'error' },
      );
    } catch (cause) {
      pushToast(describeError(cause), { tone: 'error' });
    } finally {
      setVerifying(false);
    }
  }

  // A break reported by either server check wins: the list verifies the whole log on every call, so a later
  // "intact" from the verify button must never hide it.
  const integrityValid = chain?.valid === false ? false : verifyResult ? verifyResult.chain_valid : chain?.valid;

  return (
    <section className="relative mx-auto min-h-screen w-full max-w-7xl px-4 py-6 lg:px-6">
      {/* Screen header */}
      <div className="flex flex-col justify-between gap-4 border-b border-outline-variant/40 pb-6 md:flex-row md:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-primary">
            <span className="h-2 w-2 rounded-full bg-secondary animate-pulse" aria-hidden="true" />
            <span>Tamper-evident chain-of-custody • SHA-256 hash chain</span>
          </div>
          <h1 className="font-headline text-3xl font-bold tracking-tight text-on-surface sm:text-4xl">
            Tamper-evident <span className="text-primary">audit ledger</span>
          </h1>
          <p className="mt-1 max-w-2xl font-body text-sm text-on-surface-variant">
            A tamper-evident, hash-chained event sequence recording every debate round, raw-log Watchdog check and automated containment response. Verify on the server and recompute each entry's SHA-256 in your browser.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={runVerify}
              disabled={verifying || !trail.data}
              className="flex items-center gap-2 rounded border border-secondary/40 bg-surface-card px-3 py-2 font-mono text-xs font-bold uppercase text-secondary shadow-glow-emerald transition-all hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="verified_user" size={16} className={verifying ? 'animate-pulse' : ''} />
              {verifying ? 'Verifying hashes…' : 'Verify cryptographic proof'}
            </button>
            <Proof
              source="POST /audit-trail/verify"
              n={verifyResult?.entries_checked ?? chain?.total ?? 0}
              asOf={trail.loadedAt}
              definition="Full pass (?full=true): the server recomputes every entry hash and the chain links from the first entry, returning chain_valid, entries_checked, first_break_seq, the reason and the mode that ran."
              label="Verify chain"
            />
          </span>
          <span className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={() => trail.data && exportCustodyBundle(trail.data)}
              disabled={!trail.data}
              className="flex items-center gap-2 rounded bg-primary-container px-3 py-2 font-mono text-xs font-bold uppercase text-on-primary shadow-glow-cyan transition-all hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="receipt_long" size={16} /> Export custody bundle
            </button>
            <Proof
              source="browser: GET /audit-trail entries + head hash"
              n={entries.length}
              asOf={trail.loadedAt}
              definition="Downloads the loaded entries as JSON together with the chain summary and head entry_hash. Nothing is sent to the server."
              label="Export custody bundle"
            />
          </span>
        </div>
      </div>

      <HintStrip pageId="audit" sentences={HINT} className="mt-4" />

      {/* Ledger status badges */}
      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <HudTile label="Chain head" subTone="text-secondary" sub="Increasing identity sequence">
          <span className="font-headline text-2xl font-bold text-primary">{chain?.head_seq != null ? formatSeq(chain.head_seq) : '—'}</span>
          <Proof
            source="GET /audit-trail chain.head_seq"
            n={chain?.total ?? 0}
            asOf={trail.loadedAt}
            definition="Highest audit sequence number. seq is an increasing database identity column (a rolled-back transaction can leave a number unused); the chain order is the seq order and each entry names the hash before it. There is no block height or shard."
            label="Chain head"
          />
        </HudTile>
        <HudTile label="Total entries" sub="Hash-chained records">
          <span className="font-headline text-2xl font-bold text-on-surface">{chain ? formatCount(chain.total) : '—'}</span>
          <Proof source="GET /audit-trail chain.total" n={chain?.total ?? 0} asOf={trail.loadedAt} definition="Count of audit entries in the chain." label="Total entries" />
        </HudTile>
        <HudTile
          label="Integrity verification"
          subTone={integrityValid ? 'text-secondary' : 'text-on-surface-variant'}
          sub={
            verifyResult
              ? `${formatCount(verifyResult.entries_checked)} entries checked by server (${verifyResult.mode} pass)`
              : 'Run verify for a full server check'
          }
        >
          <span className="inline-flex items-center gap-2">
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                integrityValid === undefined ? 'bg-outline' : integrityValid ? 'bg-secondary animate-pulse' : 'bg-error',
              )}
              aria-hidden="true"
            />
            <span className={cn('font-headline text-2xl font-bold', integrityValid ? 'text-secondary' : 'text-on-surface')}>
              {integrityValid === undefined ? '—' : integrityValid ? '100% intact' : 'Broken'}
            </span>
          </span>
          <Proof
            source={verifyResult ? 'POST /audit-trail/verify chain_valid' : 'GET /audit-trail chain.valid'}
            n={verifyResult?.entries_checked ?? chain?.total ?? 0}
            asOf={trail.loadedAt}
            definition="chain.valid from the list (the server checks the whole log on every list call), combined with the full verify pass once you run it. A break reported by either one shows as Broken."
            reason={verifyResult?.reason ?? null}
            label="Chain integrity"
          />
        </HudTile>
        <HudTile label="Head hash" subTone="text-primary" sub="SHA-256 of the latest entry">
          {entries[0] ? (
            <CopyHash value={entries[0].entry_hash} label="head entry hash" size="inherit" className="text-sm" textClassName="text-primary" />
          ) : (
            <span className="font-headline text-2xl font-bold text-on-surface">—</span>
          )}
        </HudTile>
      </div>

      <div className="mt-6">
        <Tabs
          label="Audit sections"
          tabs={[
            { id: 'ledger', label: 'Ledger' },
            { id: 'containment', label: 'Containment' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'containment' ? (
        <ContainmentTab />
      ) : trail.error && !trail.data ? (
        <div className="mt-4">
          <EmptyState title="Could not load the audit trail" description={trail.error} icon="warning" />
        </div>
      ) : entries.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="No audit entries yet" description="The ledger fills as investigations run. Every action is appended here." icon="receipt_long" />
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Entry history list */}
          <div className="space-y-3 lg:col-span-7">
            <div className="flex items-center justify-between px-1 font-mono text-xs text-on-surface-variant">
              <span>Hash-chain history</span>
              <span>SHA-256 hash chain</span>
            </div>
            {entries.map((entry) => {
              const isSelected = selected?.seq === entry.seq;
              return (
                <div
                  key={entry.seq}
                  className={cn(
                    'relative w-full rounded-xl border p-4 text-left transition-all',
                    isSelected
                      ? 'border-primary bg-surface-card shadow-glow-cyan ring-1 ring-primary/50'
                      : 'border-outline-variant/40 bg-surface-container-low/70 hover:border-outline-variant hover:bg-surface-card/60',
                  )}
                >
                  {/*
                    The select button comes first and covers the card; the copy buttons are positioned and later in
                    the DOM, so they paint above it and stay clickable (no button inside a button).
                  */}
                  <button
                    type="button"
                    onClick={() => setSelectedSeq(entry.seq)}
                    aria-pressed={isSelected}
                    aria-label={`Select audit entry ${formatSeq(entry.seq)}`}
                    className={cn('absolute inset-0 cursor-pointer rounded-xl', FOCUS_RING)}
                  />
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold text-primary">seq {formatSeq(entry.seq)}</span>
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase',
                            chain?.valid ? 'bg-secondary/20 text-secondary' : 'bg-error-container/40 text-error',
                          )}
                        >
                          {chain?.valid ? 'Chain OK' : 'Chain broken'}
                        </span>
                        {entry.investigation_id ? (
                          <CopyHash
                            value={entry.investigation_id}
                            display={shortId(entry.investigation_id)}
                            label="investigation id"
                            size="inherit"
                            className="text-[10px]"
                            textClassName="text-outline"
                          />
                        ) : null}
                      </div>
                      <h3 className="mt-1 break-words font-headline text-base font-semibold text-on-surface">{humanizeAction(entry.action)}</h3>
                      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 font-mono text-[11px] text-on-surface-variant">
                        Hash:
                        <CopyHash value={entry.entry_hash} label="entry hash" size="inherit" textClassName="text-primary" />
                      </div>
                    </div>
                    <Timestamp iso={entry.created_at} className="shrink-0 font-mono text-[10px] text-outline" />
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-outline-variant/30 pt-2.5 font-mono text-[10px] text-on-surface-variant">
                    <div className="flex items-center gap-1.5">
                      <Icon name="verified_user" size={12} className="text-secondary" />
                      <span className="break-all">actor {entry.actor}</span>
                    </div>
                    <span className="inline-flex flex-wrap items-center gap-1.5 text-primary">
                      prev{' '}
                      {entry.prev_hash ? (
                        <CopyHash
                          value={entry.prev_hash}
                          display={shortId(entry.prev_hash, 12)}
                          label="previous entry hash"
                          size="inherit"
                          textClassName="text-primary"
                        />
                      ) : (
                        'genesis'
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Proof inspector */}
          <div className="lg:col-span-5">{selected ? <EntryInspector entry={selected} /> : null}</div>
        </div>
      )}
    </section>
  );
}
