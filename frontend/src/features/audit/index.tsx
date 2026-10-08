import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { describeError, listAuditTrail, listResponseActions, verifyAuditTrail } from '../../api/client';
import type { AuditEntry, AuditTrailResponse, AuditVerifyResult, ResponseAction } from '../../api/types';
import { useAsync } from '../../app/use-async';
import { sha256Hex } from '../../lib/derive/hash';
import { formatCount, formatTimestamp, shortId } from '../../lib/format';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { CopyHash } from '../../ui/CopyHash';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { Pill } from '../../ui/Pill';
import { Proof } from '../../ui/Proof';
import { StatusDot } from '../../ui/StatusDot';
import { Table, type TableColumn } from '../../ui/Table';
import { Tabs } from '../../ui/Tabs';
import { pushToast } from '../../ui/toast-store';

type AuditTab = 'ledger' | 'containment';

function HudTile({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <Card variant="panel" className="flex flex-col gap-1">
      <span className="text-label uppercase text-on-surface-variant">{label}</span>
      <div className="flex flex-wrap items-baseline gap-2">{children}</div>
      {sub ? <span className="text-caption text-on-surface-variant">{sub}</span> : null}
    </Card>
  );
}

function KpiValue({ children }: { children: ReactNode }) {
  return <span className="font-headline text-kpi tabular-nums text-on-surface">{children}</span>;
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
    <div className="space-y-2 rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-label uppercase text-on-surface-variant">Browser SHA-256 recompute</span>
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
      </div>
      {error ? (
        <p className="flex items-center gap-1.5 text-caption text-error">
          <Icon name="warning" size={12} label="Error" /> {error}
        </p>
      ) : match === null ? (
        <p className="text-caption text-on-surface-variant">Computing…</p>
      ) : (
        <>
          <p className="break-all font-mono text-evidence text-on-surface">{computed}</p>
          {match ? (
            <p className="flex items-center gap-1.5 text-caption text-secondary">
              <Icon name="verified_user" size={12} label="Match" /> Matches entry_hash
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-caption text-error">
              <Icon name="warning" size={12} label="Mismatch" /> Does not match entry_hash
            </p>
          )}
        </>
      )}
    </div>
  );
}

function HashRow({ label, value, tone }: { label: string; value: string | null; tone: 'muted' | 'primary' | 'secondary' }) {
  const text = tone === 'muted' ? 'text-on-surface-variant' : tone === 'secondary' ? 'text-secondary' : 'text-primary';
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-label uppercase text-on-surface-variant">{label}</span>
      {value === null ? (
        <span className="font-mono text-evidence text-on-surface-variant">none (genesis)</span>
      ) : (
        <span className={`truncate font-mono text-evidence ${text}`} title={value}>
          {value}
        </span>
      )}
    </div>
  );
}

function EntryInspector({ entry }: { entry: AuditEntry }) {
  return (
    <Card className="sticky top-24 space-y-5" hairline>
      <div className="flex items-start justify-between gap-3 border-b border-outline-variant/40 pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-evidence font-bold text-primary">seq #{entry.seq}</span>
            <Pill tone="primary">{entry.action}</Pill>
          </div>
          <p className="mt-1 text-body text-on-surface">
            {entry.actor} · <span className="font-mono text-evidence text-on-surface-variant">{formatTimestamp(entry.created_at)}</span>
          </p>
        </div>
        <Icon name="receipt_long" size={20} className="shrink-0 text-primary" />
      </div>

      <div className="space-y-2 rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3.5">
        <div className="flex items-center justify-between">
          <span className="text-label uppercase text-on-surface-variant">Hash input (pre-image)</span>
          <Proof
            source="GET /audit-trail entries[].hash_input"
            n={1}
            asOf={entry.created_at}
            definition="The exact canonical string the server hashes. The browser recomputes SHA-256 over it below."
            label="Hash input"
          />
        </div>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded border border-outline-variant/40 bg-background p-2.5 font-mono text-evidence leading-relaxed text-primary">
          {entry.hash_input}
        </pre>
      </div>

      <div className="space-y-3 rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3.5">
        <span className="text-label uppercase text-on-surface-variant">Hash chain link</span>
        <HashRow label="Previous hash" value={entry.prev_hash} tone="muted" />
        <HashRow label="Entry hash" value={entry.entry_hash} tone="primary" />
      </div>

      <BrowserRecompute entry={entry} />

      {entry.detail && Object.keys(entry.detail).length > 0 ? (
        <div className="space-y-2 rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3.5">
          <span className="text-label uppercase text-on-surface-variant">Detail (canonical, no labels)</span>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border border-outline-variant/40 bg-background p-2.5 font-mono text-evidence leading-relaxed text-on-surface">
            {JSON.stringify(entry.detail, null, 2)}
          </pre>
        </div>
      ) : null}
    </Card>
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
        <Pill tone="secondary" icon="check">
          Simulated
        </Pill>
      ) : (
        <Pill tone="error" icon="warning">
          Not simulated
        </Pill>
      ),
  },
  { key: 'when', header: 'Recorded', cell: (row) => formatTimestamp(row.created_at), mono: true },
];

function ContainmentTab() {
  const actions = useAsync(() => listResponseActions({ limit: 100 }), 30_000);
  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-caption text-on-surface-variant">
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
  const trail = useAsync(() => listAuditTrail({ limit: 50 }), 30_000);
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
    <div className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-6">
      <header className="flex flex-col gap-4 border-b border-outline-variant/40 pb-6 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-2">
          <span className="inline-flex items-center gap-2 text-label uppercase text-primary">
            <StatusDot tone="live" /> Tamper-evident ledger · SHA-256 hash chain
          </span>
          <h1 className="font-headline text-h1 tracking-tight text-on-surface sm:text-h1-sm">
            Audit <span className="text-primary">trail</span>
          </h1>
          <p className="max-w-2xl text-body text-on-surface-variant">
            Every debate round, credibility update, containment action and sign-off, hash-chained in PostgreSQL. Verify on the server and recompute each entry's SHA-256 in your browser.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1">
            <Button variant="secondary" icon="verified_user" busy={verifying} onClick={runVerify} disabled={!trail.data}>
              Verify chain
            </Button>
            <Proof
              source="POST /audit-trail/verify"
              n={verifyResult?.entries_checked ?? chain?.total ?? 0}
              asOf={trail.loadedAt}
              definition="Server recomputes every entry hash and the chain links, returning chain_valid, entries_checked and first_break_seq."
              label="Verify chain"
            />
          </span>
          <span className="inline-flex items-center gap-1">
            <Button variant="primary" onClick={() => trail.data && exportCustodyBundle(trail.data)} disabled={!trail.data}>
              Export custody bundle
            </Button>
            <Proof
              source="browser: GET /audit-trail entries + head hash"
              n={entries.length}
              asOf={trail.loadedAt}
              definition="Downloads the loaded entries as JSON together with the chain summary and head entry_hash. Nothing is sent to the server."
              label="Export custody bundle"
            />
          </span>
        </div>
      </header>

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <HudTile label="Chain head" sub="Latest audit sequence">
          <KpiValue>{chain?.head_seq != null ? `#${formatCount(chain.head_seq)}` : '—'}</KpiValue>
          <Proof
            source="GET /audit-trail chain.head_seq"
            n={chain?.total ?? 0}
            asOf={trail.loadedAt}
            definition="Highest audit sequence number. seq is a gapless identity column, so there is no block height or shard."
            label="Chain head"
          />
        </HudTile>
        <HudTile label="Total entries" sub="Hash-chained records">
          <KpiValue>{chain ? formatCount(chain.total) : '—'}</KpiValue>
          <Proof source="GET /audit-trail chain.total" n={chain?.total ?? 0} asOf={trail.loadedAt} definition="Count of audit entries in the chain." label="Total entries" />
        </HudTile>
        <HudTile
          label="Chain integrity"
          sub={verifyResult ? `${formatCount(verifyResult.entries_checked)} entries checked by server` : 'Run verify for a full server check'}
        >
          <span className="inline-flex items-center gap-2">
            <StatusDot tone={integrityValid === undefined ? 'idle' : integrityValid ? 'ok' : 'error'} label="Chain integrity" />
            <span className="font-headline text-kpi text-on-surface">
              {integrityValid === undefined ? '—' : integrityValid ? 'Valid' : 'Broken'}
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
        <HudTile label="Head hash" sub="SHA-256 of the latest entry">
          {entries[0] ? (
            <CopyHash value={entries[0].entry_hash} label="Head entry hash" />
          ) : (
            <KpiValue>—</KpiValue>
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
        <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-3 lg:col-span-7">
            <div className="flex items-center justify-between px-1 text-label uppercase text-on-surface-variant">
              <span>Hash-chain history</span>
              <span>Newest first</span>
            </div>
            {entries.map((entry) => {
              const isSelected = selected?.seq === entry.seq;
              return (
                <button
                  key={entry.seq}
                  type="button"
                  onClick={() => setSelectedSeq(entry.seq)}
                  aria-pressed={isSelected}
                  className={`w-full rounded-xl border p-4 text-left transition-colors ${
                    isSelected
                      ? 'border-primary bg-surface-card shadow-glow-cyan'
                      : 'border-outline-variant/40 bg-surface-card hover:border-primary/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-evidence font-bold text-primary">seq #{entry.seq}</span>
                        <Pill tone="primary">{entry.action}</Pill>
                        {entry.investigation_id ? (
                          <span className="font-mono text-evidence text-on-surface-variant">{shortId(entry.investigation_id)}</span>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate font-mono text-evidence text-on-surface-variant">
                        hash: <span className="text-primary">{entry.entry_hash}</span>
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-evidence text-on-surface-variant">{formatTimestamp(entry.created_at)}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-outline-variant/40 pt-2.5 text-label uppercase text-on-surface-variant">
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="verified_user" size={12} className="text-secondary" /> actor {entry.actor}
                    </span>
                    <span className="font-mono normal-case text-on-surface-variant">prev {entry.prev_hash ? shortId(entry.prev_hash, 10) : 'genesis'}</span>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="lg:col-span-5">{selected ? <EntryInspector entry={selected} /> : null}</div>
        </div>
      )}
    </div>
  );
}
