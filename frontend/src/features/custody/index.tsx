/**
 * The printable chain-of-custody record (#/custody/<id>): who did what to one case and when, every entry with its
 * full SHA-256 and the entry it follows, the evidence bundle digest and the case digest, each recomputed in the
 * browser, and a blank hand-over block for a person to sign on paper. Like the report it prints through the
 * browser's dialog (Save as PDF); the audit trail is tamper-evident, and the page says plainly that it is not a
 * cryptographic signature.
 */
import { buildRoute } from '../../app/router';
import type { CaseLink } from '../../api/types';
import { cn } from '../../lib/cn';
import { formatCount, formatCountNoun, formatSeq, formatTimestamp, shortId } from '../../lib/format';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { Skeleton } from '../../ui/Skeleton';
import type { PageProps } from '../index';
import { STATUS_LABEL, VERDICT_LABEL } from '../investigations/labels';
import { Chip, Fact, Hash, Section, Sheet, TABLE, TD, TEXT_TONE, TH } from '../report/paper';
import { useCaseDocument } from '../report/useCaseDocument';
import { useVerification } from '../report/useVerification';

const LINK_TEXT: Record<CaseLink, string> = {
  genesis: 'first entry of the chain',
  case: 'follows this case’s previous entry',
  other: 'follows another case or the system',
};

function Check({ ok, children }: { ok: boolean | null; children: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px] font-semibold', ok === null ? TEXT_TONE.neutral : ok ? TEXT_TONE.secondary : TEXT_TONE.error)}>
      <Icon name={ok === null ? 'schedule' : ok ? 'check_circle' : 'cancel'} size={14} />
      {children}
    </span>
  );
}

/** The lines a person fills in by hand when the case changes hands. */
const HANDOVER_FIELDS = ['Handed over by', 'Received by', 'Role', 'Signature', 'Date and time (UTC)'] as const;

export default function CustodyPage({ id }: PageProps) {
  const caseId = id ?? '';
  const doc = useCaseDocument(caseId);
  const verification = useVerification(doc.bundle, doc.chain, doc.status === 'ready');
  const sheet = { backHref: buildRoute({ name: 'investigation', id: caseId }), backLabel: 'Back to the investigation' };

  if (id === undefined) {
    return (
      <Sheet {...sheet} fileName="VerdictChain-custody" ready={false}>
        <EmptyState title="No investigation chosen" description="Open the custody record from an investigation's dossier." />
      </Sheet>
    );
  }
  if (doc.status === 'loading') {
    return (
      <Sheet {...sheet} fileName="VerdictChain-custody" ready={false}>
        <Skeleton className="h-40 w-full" />
      </Sheet>
    );
  }
  const detail = doc.detail;
  if (doc.status === 'failed' || detail === undefined) {
    return (
      <Sheet {...sheet} fileName="VerdictChain-custody" ready={false}>
        <EmptyState title="The custody record could not be built" description={doc.error ?? 'The investigation could not be read.'} icon="warning" />
      </Sheet>
    );
  }

  const chain = doc.chain;
  const check = verification.chain.state === 'done' ? verification.chain.check : null;
  const mismatched = new Set(check?.mismatched ?? []);
  const generatedAt = doc.generatedAt ?? new Date().toISOString();
  const first = chain?.entries[0];
  const last = chain && chain.entries.length > 0 ? chain.entries[chain.entries.length - 1] : undefined;
  const bundleOk = verification.bundle === 'match' ? true : verification.bundle === 'mismatch' ? false : null;

  return (
    <Sheet {...sheet} fileName={`VerdictChain-custody-${shortId(detail.id)}`} ready={verification.settled}>
      <header aria-label="Custody cover" className="relative overflow-hidden rounded-xl bg-surface p-5 text-on-surface">
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-linear-to-r from-primary via-secondary to-tertiary" />
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/assets/logo-emblem.png" alt="" className="h-10 w-10 rounded-lg border border-primary-container/40 bg-surface-card p-1.5" />
            <div>
              <div className="font-headline text-lg font-bold tracking-tight">
                VERDICT<span className="text-primary">CHAIN</span>
              </div>
              <div className="font-mono text-[9px] uppercase tracking-widest text-on-surface-variant">Multi-agent forensic console</div>
            </div>
          </div>
          <div className="text-right font-mono text-[10px] text-on-surface-variant">
            <div className="uppercase tracking-widest text-primary">Chain of custody</div>
            <div>Generated {formatTimestamp(generatedAt)}</div>
            {doc.me && <div>by {doc.me.username}</div>}
          </div>
        </div>
        <div className="mt-5">
          <div className="font-headline text-2xl font-bold leading-tight">Custody record</div>
          <div className="mt-1 break-all font-mono text-[10px] text-on-surface-variant">Case {detail.id}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="rounded-full border border-outline-variant/60 bg-surface-card px-2 py-0.5 font-mono text-[9px] uppercase text-on-surface-variant">{STATUS_LABEL[detail.status]}</span>
            {detail.verdict_class && <span className="rounded-full border border-outline-variant/60 bg-surface-card px-2 py-0.5 font-mono text-[9px] uppercase text-on-surface-variant">{VERDICT_LABEL[detail.verdict_class]}</span>}
          </div>
        </div>
      </header>

      <Section title="Custody summary" note="the digests are recomputed in the browser, not copied">
        <div className="grid grid-cols-2 gap-3">
          <Fact label="Entries of this case">{chain ? `${formatCount(chain.entries.length)} of the ${formatCount(chain.chain.total)} entries of the global chain` : 'not available'}</Fact>
          <Fact label="Span">{first && last ? `${formatTimestamp(first.created_at)} to ${formatTimestamp(last.created_at)}` : '—'}</Fact>
          <Fact label="Evidence bundle SHA-256" className="col-span-2">
            {doc.bundle ? <Hash value={doc.bundle.bundle_sha256} /> : <span className="text-ink-muted">not available</span>}
          </Fact>
          <Fact label="Case digest (SHA-256 of the entry hashes, oldest first)" className="col-span-2">
            {chain?.case_digest ? <Hash value={chain.case_digest} /> : <span className="text-ink-muted">no entries, so no digest</span>}
          </Fact>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
          <Check ok={bundleOk}>{bundleOk === null ? 'Bundle hash not recomputed' : bundleOk ? 'Bundle hash recomputed here: it matches' : 'Bundle hash recomputed here: it does NOT match'}</Check>
          <Check ok={check ? mismatched.size === 0 : null}>{check ? `${formatCount(check.matching)} of ${formatCount(check.total)} entry hashes recomputed here match` : 'Entry hashes not recomputed'}</Check>
          <Check ok={check ? check.digestMatches : null}>{check ? (check.digestMatches ? 'Case digest recomputed here: it matches' : 'Case digest recomputed here: it does NOT match') : 'Case digest not recomputed'}</Check>
          <Check ok={chain ? chain.chain.valid : null}>{chain ? (chain.chain.valid ? 'Global audit chain valid' : 'Global audit chain broken') : 'Global chain not verified'}</Check>
        </div>
        {chain && <p className="mt-2 text-[10px] text-ink-muted">Digest rule: {chain.digest_rule}</p>}
      </Section>

      <Section title="Custody events" note="oldest first; each entry carries the hash of the one before it">
        {chain === undefined ? (
          <p className="text-ink-muted">The audit entries could not be read{doc.missing['case audit chain'] ? `: ${doc.missing['case audit chain']}` : ''}.</p>
        ) : chain.entries.length === 0 ? (
          <p className="text-ink-muted">No audit entry has been written for this case yet.</p>
        ) : (
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>#</th>
                <th className={TH}>Recorded (UTC)</th>
                <th className={TH}>Actor</th>
                <th className={TH}>Action</th>
                <th className={TH}>Hash recomputed here</th>
              </tr>
            </thead>
            {/* One group per entry (kept together on a page): the facts, then its full SHA-256 and the entry it follows. */}
            {chain.entries.map((entry) => (
              <tbody key={entry.seq} className="break-inside-avoid">
                <tr>
                  <td className="whitespace-nowrap px-2 pt-1.5 align-top font-mono">{formatSeq(entry.seq)}</td>
                  <td className="whitespace-nowrap px-2 pt-1.5 align-top font-mono">{formatTimestamp(entry.created_at).replace(' UTC', '')}</td>
                  <td className="px-2 pt-1.5 align-top">{entry.actor}</td>
                  <td className="px-2 pt-1.5 align-top font-semibold">{entry.action}</td>
                  <td className="px-2 pt-1.5 align-top">{check === null ? '…' : mismatched.has(entry.seq) ? <span className={TEXT_TONE.error}>no, differs</span> : <span className={TEXT_TONE.secondary}>yes, matches</span>}</td>
                </tr>
                <tr>
                  <td colSpan={5} className="border-b border-paper-rule px-2 pb-1.5 pt-0.5">
                    <Hash value={entry.entry_hash} className="text-[8.5px] text-ink" />
                    <span className="ml-2 text-[9px] text-ink-muted">
                      {LINK_TEXT[entry.links_to]}
                      {entry.prev_hash ? ` · ${entry.prev_hash.slice(0, 16)}…` : ''}
                    </span>
                  </td>
                </tr>
              </tbody>
            ))}
          </table>
        )}
      </Section>

      <Section title="Recorded acknowledgements" note="audited sign-offs inside the console">
        {doc.bundle === undefined ? (
          <p className="text-ink-muted">The evidence bundle could not be read, so its acknowledgements are not listed.</p>
        ) : doc.bundle.signatures.length === 0 ? (
          <p className="text-ink-muted">No analyst has recorded a sign-off for this case.</p>
        ) : (
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>Analyst</th>
                <th className={TH}>Recorded (UTC)</th>
                <th className={TH}>Bundle hash at that time</th>
                <th className={TH}>Still the same bundle</th>
              </tr>
            </thead>
            <tbody>
              {doc.bundle.signatures.map((signature) => (
                <tr key={`${signature.signed_by}|${signature.signed_at}`} className="break-inside-avoid">
                  <td className={TD}>{signature.signed_by}</td>
                  <td className={cn(TD, 'font-mono')}>{formatTimestamp(signature.signed_at).replace(' UTC', '')}</td>
                  <td className={TD}>
                    <Hash value={signature.bundle_sha256} className="text-[8px]" />
                  </td>
                  <td className={TD}>{signature.still_matches ? <Chip tone="secondary">yes</Chip> : <Chip tone="error">changed</Chip>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Hand-over record" note="filled in by hand when the case changes hands">
        <div className="grid grid-cols-2 gap-x-6 gap-y-5">
          {HANDOVER_FIELDS.map((field) => (
            <div key={field} className="break-inside-avoid">
              <div className="h-7 border-b border-ink-muted" />
              <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-ink-muted">{field}</div>
            </div>
          ))}
        </div>
      </Section>

      <footer className="mt-6 border-t border-paper-rule pt-2 text-[9px] leading-snug text-ink-muted">
        This record lists {chain ? formatCountNoun(chain.entries.length, 'entry', 'entries') : 'the entries'} of a SHA-256 hash chain. It is tamper-evident: each entry carries the hash of the one before it, so a changed entry shows up as a mismatch. It is not a cryptographic signature, and a sign-off recorded in the console is an audited acknowledgement, not a digital signature. Sources: GET /investigations/{'{id}'}/audit-chain · /evidence-bundle.
      </footer>
    </Sheet>
  );
}
