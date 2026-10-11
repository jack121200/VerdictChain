/** The table of every cited row with the Watchdog's result. */
import type { Citation, InvestigatorId } from '../../api/types';
import { AGENT_VISUALS, INVESTIGATOR_VISUALS } from '../../lib/agents';
import { cn } from '../../lib/cn';
import { CopyHash } from '../../ui/CopyHash';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { Proof } from '../../ui/Proof';
import { Skeleton } from '../../ui/Skeleton';
import { citationMeta } from './derive';
import { TONE_PILL, TONE_TEXT } from './shared';

// ---- cited artifacts -------------------------------------------------------------

export function CitedArtifacts({
  citations,
  agentName,
  loading,
  loadedAt,
}: {
  citations: readonly Citation[];
  agentName: (agentId: InvestigatorId) => string;
  loading: boolean;
  loadedAt: string | null;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-outline-variant/40 bg-surface-container-low p-4 shadow-lg sm:p-5">
      <div className="flex flex-col justify-between gap-1 border-b border-outline-variant/30 pb-2 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <Icon name="travel_explore" size={20} className="text-primary" />
          <h3 className="font-headline text-base font-bold text-on-surface">Cited forensic artifacts (underlying ground-truth rows)</h3>
        </div>
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-on-surface-variant">
          Re-checked against raw_logs in PostgreSQL
          <Proof
            source="GET /investigations/{id}/citations"
            n={citations.length}
            asOf={loadedAt}
            label="Cited artifacts"
            definition="Every cited raw_logs row with its field, value, citing agent, round, Watchdog status and the SHA-256 row fingerprint. The fingerprint replaces the design's invented hash."
          />
        </span>
      </div>

      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : citations.length === 0 ? (
        <EmptyState title="No cited artifacts" description="This case has cited no raw_logs rows yet." />
      ) : (
        <div className="w-full overflow-x-auto">
          <table className="w-full border-collapse text-left font-mono text-[11px]">
            <caption className="sr-only">Cited raw_logs rows for this investigation</caption>
            <thead>
              <tr className="border-b border-outline-variant/40 bg-background text-[10px] uppercase text-on-surface-variant">
                <th className="p-2.5">Row ID</th>
                <th className="p-2.5">Field</th>
                <th className="p-2.5">Observed value</th>
                <th className="p-2.5">Citing agent</th>
                <th className="p-2.5">Round</th>
                <th className="p-2.5">Fingerprint</th>
                <th className="p-2.5 text-right">Watchdog status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/20">
              {citations.map((citation, index) => {
                const metaCitation = citationMeta(citation.status);
                return (
                  <tr key={`${citation.row_id}-${citation.field}-${index}`} className="transition-colors hover:bg-surface-card">
                    <td className="p-2.5 font-bold text-primary">#{citation.row_id}</td>
                    <td className="p-2.5 text-on-surface">{citation.field}</td>
                    <td className="p-2.5 text-on-surface">
                      {citation.value ?? '—'}
                      {citation.status === 'DISCREPANCY' && citation.expected !== null && (
                        <span className="text-tertiary"> (expected {citation.expected})</span>
                      )}
                    </td>
                    <td className={cn('p-2.5 font-semibold', TONE_TEXT[INVESTIGATOR_VISUALS[citation.agent_id].tone])}>
                      {AGENT_VISUALS[citation.agent_id].glyph} {agentName(citation.agent_id)}
                    </td>
                    <td className="p-2.5 text-on-surface-variant">{citation.round}</td>
                    <td className="p-2.5">
                      {citation.row_fingerprint ? <CopyHash value={citation.row_fingerprint} label={`row fingerprint for row ${citation.row_id}`} /> : <span className="text-on-surface-variant">—</span>}
                    </td>
                    <td className="p-2.5 text-right">
                      <span className={cn('inline-flex items-center gap-1 rounded border px-2 py-0.5 font-bold uppercase', TONE_PILL[metaCitation.tone])}>
                        <Icon name={metaCitation.icon} size={12} /> {metaCitation.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
