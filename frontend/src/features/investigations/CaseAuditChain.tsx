import { useEffect, useState, type ReactNode } from 'react';
import { describeError, getCaseAuditChain } from '../../api/client';
import type { CaseAuditChain, CaseLink } from '../../api/types';
import { PageState } from '../../app/PageState';
import { useAsync } from '../../app/use-async';
import { pageStatus } from '../../app/use-page-data';
import { cn } from '../../lib/cn';
import { formatCount, formatSeq } from '../../lib/format';
import { CopyHash } from '../../ui/CopyHash';
import { Icon } from '../../ui/Icon';
import { Proof } from '../../ui/Proof';
import { Skeleton } from '../../ui/Skeleton';
import { Timestamp } from '../../ui/Timestamp';
import { recomputeCaseChain, type CaseChainCheck } from './case-chain';
import { Panel } from './Panel';

const LINK_TEXT: Record<CaseLink, string> = {
  genesis: 'first entry of the whole chain',
  case: 'follows this case’s previous entry',
  other: 'follows an entry of another case or of the system',
};

type Recompute = { state: 'checking' } | { state: 'error'; message: string } | { state: 'done'; check: CaseChainCheck };

/** Recomputes the case's hashes and digest in the browser each time the server's answer changes. */
function useRecompute(chain: CaseAuditChain | undefined): Recompute {
  const [result, setResult] = useState<Recompute>({ state: 'checking' });
  useEffect(() => {
    if (chain === undefined) return undefined;
    let cancelled = false;
    setResult({ state: 'checking' });
    recomputeCaseChain(chain).then(
      (check) => {
        if (!cancelled) setResult({ state: 'done', check });
      },
      (cause: unknown) => {
        if (!cancelled) setResult({ state: 'error', message: describeError(cause) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [chain]);
  return result;
}

function CheckLine({ ok, children }: { ok: boolean | null; children: ReactNode }) {
  const icon = ok === null ? 'schedule' : ok ? 'check_circle' : 'cancel';
  return (
    <div className={cn('flex items-start gap-1.5 text-[11px]', ok === false ? 'text-error' : 'text-on-surface-variant')}>
      <Icon name={icon} size={14} className={cn('mt-px shrink-0', ok === true && 'text-secondary', ok === false && 'text-error')} />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/**
 * The entries of one case in chain order (GET /investigations/{id}/audit-chain), with the two things the browser can
 * check for itself: every entry's SHA-256 over its hash_input, and the case digest. It is a view of the global chain,
 * not a second chain: each entry still points at the one before it, and the panel says so.
 */
export function CaseAuditChainPanel({ investigationId }: { investigationId: string }) {
  const chainQuery = useAsync(() => getCaseAuditChain(investigationId), undefined, ['audit', 'investigations'], [investigationId]);
  const chain = chainQuery.data?.investigation_id === investigationId ? chainQuery.data : undefined;
  const recompute = useRecompute(chain);

  return (
    <Panel
      title="Case audit chain"
      action={
        chain && (
          <Proof
            source="GET /investigations/{id}/audit-chain · browser SHA-256"
            n={chain.count.n}
            asOf={chainQuery.loadedAt}
            label="Case audit chain"
            definition={`The audit entries written for this case, in chain order. They are not a separate chain: each entry still points at the previous entry of the one global chain. The browser recomputes every entry's SHA-256 over its hash_input and the case digest, and the server's values must equal them. Digest rule: ${chain.digest_rule}`}
          />
        )
      }
    >
      <PageState
        page={{ status: pageStatus({ data: chain, error: chainQuery.error }), error: chainQuery.error }}
        skeleton={<Skeleton className="h-4 w-44" />}
        prefix="— "
        className="text-[11px] text-error"
      />

      {chain && chain.entries.length === 0 && (
        <p className="text-[11px] text-on-surface-variant">No audit entries have been written for this case yet.</p>
      )}

      {chain && chain.entries.length > 0 && (
        <>
          <p className="text-[11px] text-on-surface-variant">
            <span className="font-mono text-on-surface">{formatCount(chain.entries.length)}</span> of the {formatCount(chain.chain.total)} entries of the global
            chain belong to this case. They are not a separate chain: each still points at the entry before it.
          </p>

          <div className="space-y-1" role="group" aria-label="Case audit chain checks">
            {recompute.state === 'checking' && <CheckLine ok={null}>Recomputing in this browser…</CheckLine>}
            {recompute.state === 'error' && <CheckLine ok={false}>{recompute.message}</CheckLine>}
            {recompute.state === 'done' && (
              <>
                <CheckLine ok={recompute.check.mismatched.length === 0}>
                  Every entry’s SHA-256 recomputed here:{' '}
                  <span className="font-mono text-on-surface">
                    {formatCount(recompute.check.matching)} of {formatCount(recompute.check.total)} match
                  </span>
                  {recompute.check.mismatched.length > 0 && <> (does not match: entry {recompute.check.mismatched.map((seq) => formatSeq(seq)).join(', ')})</>}
                </CheckLine>
                <CheckLine ok={recompute.check.digestMatches}>
                  Case digest recomputed here {recompute.check.digestMatches ? 'equals' : 'does not equal'} the server’s{' '}
                  {chain.case_digest && <CopyHash value={chain.case_digest} display={chain.case_digest.slice(0, 12)} label="case digest" />}
                </CheckLine>
                <CheckLine ok={chain.chain.valid}>
                  Global chain {chain.chain.valid ? 'valid' : 'broken'} ({formatCount(chain.chain.total)} entries, checked by the server)
                </CheckLine>
              </>
            )}
          </div>

          <details className="text-[11px]">
            <summary className="cursor-pointer font-mono text-[10px] uppercase text-on-surface-variant">Entries, oldest first</summary>
            <ol className="mt-1.5 space-y-1.5">
              {chain.entries.map((entry) => (
                <li key={entry.seq} className="rounded border border-outline-variant/30 bg-surface-card p-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-1 font-mono">
                    <span className="text-on-surface">
                      {formatSeq(entry.seq)} · {entry.action}
                    </span>
                    <Timestamp iso={entry.created_at} mode="clock" className="text-on-surface-variant" />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 text-on-surface-variant">
                    <span>actor {entry.actor}</span>
                    <CopyHash value={entry.entry_hash} display={entry.entry_hash.slice(0, 12)} label={`entry hash ${formatSeq(entry.seq)}`} />
                  </div>
                  <div className="text-[10px] text-on-surface-variant">{LINK_TEXT[entry.links_to]}</div>
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
    </Panel>
  );
}
