/** The rows the Watchdog checked for the latest case. */
import type { Citation } from '../../api/types';
import { INVESTIGATOR_VISUALS } from '../../lib/agents';
import { cn } from '../../lib/cn';
import { CopyHash } from '../../ui/CopyHash';
import { Icon } from '../../ui/Icon';
import { Proof } from '../../ui/Proof';
import { Skeleton } from '../../ui/Skeleton';
import { citationStatusMeta } from './derive';
import { TONE_HOVER, TONE_TEXT } from './shared';

// ---- 5. Forensic evidence traces --------------------------------------------------

/** Decorative reference images, kept per user directive 0b. Captions are driven by real citations only. */
export const EVIDENCE_IMAGES: readonly { src: string; alt: string }[] = [
  { src: '/assets/usb-chip-macro.jpg', alt: 'Abstract macro photograph of a circuit board, decorative' },
  { src: '/assets/datacenter-racks.jpg', alt: 'Abstract server racks with fibre cabling, decorative' },
  { src: '/assets/turnstile-badge-desk.jpg', alt: 'Abstract security operations desk, decorative' },
];

export function EvidenceTraces({ citations, loading }: { citations: readonly Citation[] | undefined; loading: boolean }) {
  const shown = (citations ?? []).slice(0, 3);
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <span className="font-headline text-base font-semibold uppercase tracking-wider text-on-surface">Cited forensic evidence</span>
        <span className="inline-flex items-center gap-1.5 font-mono text-xs uppercase text-on-surface-variant">
          Latest cited rows, checked against raw_logs
          <Proof
            source="GET /investigations/{id}/citations"
            n={citations?.length ?? 0}
            asOf={null}
            label="Evidence traces"
            definition="The latest investigation's cited raw_logs rows: row id, field, value, the Watchdog's per-citation status and a fingerprint (the SHA-256 of the raw row, so anyone can recompute it from the database). The images are decorative; every caption is a real cited value."
          />
        </span>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {EVIDENCE_IMAGES.map((image, index) => {
            const citation = shown[index];
            const meta = citation ? citationStatusMeta(citation.status) : null;
            return (
              <div
                key={image.src}
                className={cn(
                  'group flex flex-col justify-between overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-card shadow-lg transition-all',
                  meta ? TONE_HOVER[meta.tone] : 'hover:border-outline-variant',
                )}
              >
                <div className="relative h-44 w-full overflow-hidden">
                  <img src={image.src} alt={image.alt} className="h-full w-full object-cover opacity-90 transition-transform duration-500 group-hover:scale-105" />
                  <div aria-hidden="true" className="absolute inset-0 bg-linear-to-t from-surface-card via-transparent to-transparent" />
                  {citation ? (
                    <>
                      <div className="absolute left-2 top-2 rounded bg-surface-container-lowest/80 px-2 py-0.5 font-mono text-[10px] font-semibold text-primary backdrop-blur">
                        row {citation.row_id}
                      </div>
                      <div className={cn('absolute bottom-2 left-2 inline-flex items-center gap-1 rounded bg-surface-container-lowest/80 px-2 py-0.5 font-mono text-[10px] font-semibold backdrop-blur', TONE_TEXT[meta!.tone])}>
                        <Icon name={meta!.icon} size={12} /> {meta!.label}
                      </div>
                    </>
                  ) : (
                    <div className="absolute left-2 top-2 rounded bg-surface-container-lowest/80 px-2 py-0.5 font-mono text-[10px] font-semibold text-on-surface-variant backdrop-blur">
                      Forensic console
                    </div>
                  )}
                </div>
                <div className="space-y-1.5 p-3.5">
                  {citation ? (
                    <>
                      <div className="font-mono text-xs font-semibold text-on-surface">
                        {citation.field}: <span className="text-on-surface-variant">{citation.value ?? '—'}</span>
                      </div>
                      {citation.status === 'DISCREPANCY' && citation.expected !== null && (
                        <div className="font-mono text-[10px] text-tertiary">expected: {citation.expected}</div>
                      )}
                      <div className="flex items-center justify-between border-t border-outline-variant/20 pt-2 font-mono text-[10px] text-on-surface-variant">
                        <span>
                          cited by <span className="text-on-surface">{INVESTIGATOR_VISUALS[citation.agent_id].glyph} {citation.agent_id}</span>
                        </span>
                        <span>round {citation.round}</span>
                      </div>
                      {citation.row_fingerprint && <CopyHash value={citation.row_fingerprint} label={`row fingerprint for row ${citation.row_id}`} />}
                    </>
                  ) : (
                    <>
                      <div className="font-headline text-base font-semibold text-on-surface">Awaiting cited evidence</div>
                      <p className="font-body text-xs leading-relaxed text-on-surface-variant">
                        This panel fills with a real cited raw_logs row once the latest investigation cites more evidence.
                      </p>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
