/** The cover band of the case report: brand, the verdict at a glance and the agent-reported confidence ring. */
import type { InvestigationDetail } from '../../api/types';
import { formatPercent, formatTimestamp } from '../../lib/format';
import { Ring } from '../../ui/Ring';
import { STATUS_LABEL, VERDICT_LABEL, verdictTone, type PillTone } from '../investigations/labels';
import { triggerLabel } from '../investigations/pipeline';

const VERDICT_TEXT: Record<PillTone, string> = {
  error: 'text-error',
  tertiary: 'text-tertiary',
  secondary: 'text-secondary',
  primary: 'text-primary',
  neutral: 'text-on-surface',
};

const RING_TONE: Record<PillTone, 'primary' | 'secondary' | 'tertiary' | 'error'> = {
  error: 'error',
  tertiary: 'tertiary',
  secondary: 'secondary',
  primary: 'primary',
  neutral: 'primary',
};

function CoverChip({ children }: { children: string }) {
  return <span className="rounded-full border border-outline-variant/60 bg-surface-card px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-on-surface-variant">{children}</span>;
}

export interface ReportCoverProps {
  detail: InvestigationDetail;
  generatedAt: string;
  generatedBy: string | null;
}

export function ReportCover({ detail, generatedAt, generatedBy }: ReportCoverProps) {
  const tone = verdictTone(detail.verdict_class);
  return (
    <header aria-label="Report cover" className="relative overflow-hidden rounded-xl bg-surface p-5 text-on-surface">
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
          <div className="uppercase tracking-widest text-primary">Investigation report</div>
          <div>Generated {formatTimestamp(generatedAt)}</div>
          {generatedBy && <div>by {generatedBy}</div>}
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between gap-6">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">Verdict</div>
          <div className={`font-headline text-4xl font-bold leading-tight ${VERDICT_TEXT[tone]}`}>{detail.verdict_class === null ? 'No verdict' : VERDICT_LABEL[detail.verdict_class]}</div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <CoverChip>{STATUS_LABEL[detail.status]}</CoverChip>
            {detail.dataset && <CoverChip>{detail.dataset}</CoverChip>}
            <CoverChip>{`started by ${triggerLabel(detail.trigger_type)}`}</CoverChip>
          </div>
          <div className="mt-3 break-all font-mono text-[10px] text-on-surface-variant">Case {detail.id}</div>
        </div>
        <Ring value={detail.verdict_confidence} size={96} strokeWidth={8} tone={RING_TONE[tone]} label="Agent-reported verdict confidence">
          <div className="text-center">
            <div className="font-headline text-lg font-bold">{detail.verdict_confidence === null ? '—' : formatPercent(detail.verdict_confidence, 1)}</div>
            <div className="font-mono text-[8px] uppercase text-on-surface-variant">agent-reported</div>
          </div>
        </Ring>
      </div>
    </header>
  );
}
