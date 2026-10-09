import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { describeError, listAuditTrail, listResponseActions, verifyAuditTrail } from '../../api/client';
import type { AuditEntry, AuditTrailResponse, AuditVerifyResult, ResponseAction } from '../../api/types';
import { useAsync } from '../../app/use-async';
import { cn } from '../../lib/cn';
import { sha256Hex } from '../../lib/derive/hash';
import { formatCount, formatTimestamp, shortId } from '../../lib/format';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { Proof } from '../../ui/Proof';
import { Table, type TableColumn } from '../../ui/Table';
import { Tabs } from '../../ui/Tabs';
import { pushToast } from '../../ui/toast-store';

type AuditTab = 'ledger' | 'containment';

/** Presentation label for an audit action code: a pure function of the API field. */
function humanizeAction(action: string): string {
  const base = action.startsWith('release:') ? `release ${action.slice('release:'.length)}` : action;
  return base.replace(/[_:]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function HudTile({ label, children, sub, subTone }: { label: string; children: ReactNode; sub: ReactNode; subTone?: string }) {
  return (
    <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low/80 p-4 backdrop-blur-md">
      <div className="font-mono text-[10px] uppercase text-on-surface-variant">{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-2">{children}</div>
      <div className={cn('mt-1 font-mono text-[10px]', subTone ?? 'text-on-surface-variant')}>{sub}</div>
    </div>
  );
}

function BoxLabel({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="flex items-center justify-between font-mono text-[10px] font-semibold uppercase text-outline">
      <span>{children}</span>
      {trailing}
    </div>
  );
}

/** Recomputes SHA-256 over the selected entry's hash_input in the browser and checks it against entry_hash. */
function BrowserRecompute({ entry }: { entry: AuditEntry }) {
  const [computed, setComputed] = useState<string | null>(null);
  const [match, setMatch] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setComputed(null);
    setMatch(null);
    setError(null);
    sha256Hex(entry.hash_input).then(
      (hash) => {
        if (cancelled) return;
        setComputed(hash);
        setMatch(hash === entry.entry_hash.toLowerCase());
      },
      (cause: unknown) => {
        if (!cancelled) setError(describeError(cause));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [entry]);

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

function EntryInspector({ entry }: { entry: AuditEntry }) {
  return (
    <div className="sticky top-24 space-y-5 rounded-2xl border border-outline-variant/50 bg-surface-container-low p-5 shadow-2xl backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3 border-b border-outline-variant/40 pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold text-primary">seq #{entry.seq}</span>
            <span className="rounded bg-secondary/20 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-secondary">Verified proof</span>
          </div>
          <h2 className="mt-1 font-headline text-lg font-bold text-on-surface">{humanizeAction(entry.action)}</h2>
          <p className="mt-0.5 font-mono text-[11px] text-on-surface-variant">
            {entry.actor} · {formatTimestamp(entry.created_at)}
          </p>
        </div>
        <Icon name="verified_user" size={20} className="shrink-0 text-secondary" />
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
          <code className="truncate text-[11px] text-outline">{entry.prev_hash ?? 'none (genesis)'}</code>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-on-surface-variant">Current entry hash:</span>
          <code className="truncate text-[11px] text-primary">{entry.entry_hash}</code>
        </div>
      </div>

      {/* Honest browser SHA-256 recompute of this entry */}
      <BrowserRecompute entry={entry} />

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

const CONTAINMENT_COLUMNS: readonly TableColumn<ResponseAction>[] = [
  { key: 'action', header: 'Action', cell: (row) => row.action_type, mono: true },
  { key: 'target', header: 'Target', cell: (row) => row.target, mono: true },
  { key: 'reason', header: 'Reason', cell: (row) => row.reason ?? '—' },
  {
    key: 'simulated',
    header: 'Mode',
    cell: (row) =>
      row.is_simulated ? (
        <span className="inline-flex items-center gap-1 font-mono text-[11px] font-bold text-secondary">
          <Icon name="check" size={12} /> Simulated
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 font-mono text-[11px] font-bold text-error">
          <Icon name="warning" size={12} /> Not simulated
        </span>
      ),
  },
  { key: 'when', header: 'Recorded', cell: (row) => formatTimestamp(row.created_at), mono: true },
];

function ContainmentTab() {
  const actions = useAsync(() => listResponseActions({ limit: 100 }), 30_000, ['actions']);
  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center gap-2">
        <p className="font-body text-xs text-on-surface-variant">
          Every self-healing response is recorded with its simulation flag (GET /response-actions). Sandbox actions never reach a real system.
        </p>
        <Proof
          source="GET /response-actions"
          n={actions.data?.length ?? 0}
          asOf={actions.loadedAt}
          definition="Response actions with action_type, target, reason and is_simulated. is_simulated is true for every sandboxed action."
          label="Containment actions"
        />
      </div>
      {actions.error && !actions.data ? (
        <EmptyState title="Could not load containment actions" description={actions.error} icon="warning" />
      ) : (
        <Table
          caption="Containment actions"
          columns={CONTAINMENT_COLUMNS}
          rows={actions.data ?? []}
          rowKey={(row) => row.id}
          empty={<EmptyState title="No containment actions yet" description="Sandboxed responses appear here once a threat verdict triggers one." icon="info" />}
        />
      )}
    </div>
  );
}

function exportCustodyBundle(data: AuditTrailResponse): void {
  const headHash = data.entries[0]?.entry_hash ?? null;
  const bundle = {
    exported_at: new Date().toISOString(),
    chain: data.chain,
    head_hash: headHash,
    entries: data.entries,
  };
  try {
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `verdictchain-audit-${data.chain.head_seq ?? 'head'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    pushToast(`Exported ${data.entries.length} audit entries with head hash.`, { tone: 'secondary' });
  } catch (cause) {
    pushToast(describeError(cause), { tone: 'error' });
  }
}

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
      const result = await verifyAuditTrail();
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

  const integrityValid = verifyResult ? verifyResult.chain_valid : chain?.valid;

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

        <div className="flex shrink-0 items-center gap-3">
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
              definition="Server recomputes every entry hash and the chain links, returning chain_valid, entries_checked and first_break_seq."
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

      {/* Ledger status badges */}
      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <HudTile label="Chain head" subTone="text-secondary" sub="Gapless identity sequence">
          <span className="font-headline text-2xl font-bold text-primary">{chain?.head_seq != null ? `#${formatCount(chain.head_seq)}` : '—'}</span>
          <Proof
            source="GET /audit-trail chain.head_seq"
            n={chain?.total ?? 0}
            asOf={trail.loadedAt}
            definition="Highest audit sequence number. seq is a gapless identity column, so there is no block height or shard."
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
          sub={verifyResult ? `${formatCount(verifyResult.entries_checked)} entries checked by server` : 'Run verify for a full server check'}
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
            definition="chain.valid from the list, upgraded to the server verify result once you run it."
            reason={verifyResult?.reason ?? null}
            label="Chain integrity"
          />
        </HudTile>
        <HudTile label="Head hash" subTone="text-primary" sub="SHA-256 of the latest entry">
          {entries[0] ? (
            <code className="block max-w-full truncate font-mono text-sm text-primary" title={entries[0].entry_hash}>
              {entries[0].entry_hash}
            </code>
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
                <button
                  key={entry.seq}
                  type="button"
                  onClick={() => setSelectedSeq(entry.seq)}
                  aria-pressed={isSelected}
                  className={cn(
                    'relative w-full rounded-xl border p-4 text-left transition-all',
                    isSelected
                      ? 'border-primary bg-surface-card shadow-glow-cyan ring-1 ring-primary/50'
                      : 'border-outline-variant/40 bg-surface-container-low/70 hover:border-outline-variant hover:bg-surface-card/60',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-primary">seq #{entry.seq}</span>
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase',
                            chain?.valid ? 'bg-secondary/20 text-secondary' : 'bg-error-container/40 text-error',
                          )}
                        >
                          {chain?.valid ? 'Chain OK' : 'Chain broken'}
                        </span>
                        {entry.investigation_id ? <span className="font-mono text-[10px] text-outline">{shortId(entry.investigation_id)}</span> : null}
                      </div>
                      <h3 className="mt-1 font-headline text-base font-semibold text-on-surface">{humanizeAction(entry.action)}</h3>
                      <div className="mt-1 truncate font-mono text-[11px] text-on-surface-variant">
                        Hash: <code className="text-primary">{entry.entry_hash}</code>
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] text-outline">{entry.created_at.substring(11, 19)} UTC</span>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-outline-variant/30 pt-2.5 font-mono text-[10px] text-on-surface-variant">
                    <div className="flex items-center gap-1.5">
                      <Icon name="verified_user" size={12} className="text-secondary" />
                      <span>actor {entry.actor}</span>
                    </div>
                    <span className="text-primary">prev {entry.prev_hash ? shortId(entry.prev_hash, 12) : 'genesis'}</span>
                  </div>
                </button>
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
