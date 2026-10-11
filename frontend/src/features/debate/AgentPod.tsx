/** One investigator's lane in the Debate Room: theory, stance, confidence, credibility and citations. */
import type { FleetEntry } from '../../api/types';
import { AGENT_VISUALS, INVESTIGATOR_VISUALS } from '../../lib/agents';
import { cn } from '../../lib/cn';
import { formatCountNoun } from '../../lib/format';
import { Icon } from '../../ui/Icon';
import { Proof } from '../../ui/Proof';
import { Ring } from '../../ui/Ring';
import { Sparkline } from '../../ui/Sparkline';
import { INPUT_BASIS_LABEL, laneAbsence, laneFor, stanceLabel, type LiveDebate } from './derive';
import { PERCENT1, TONE_GLYPH_BOX, TONE_HOVER, TONE_PILL, TONE_TEXT } from './shared';

// ---- agent pod -------------------------------------------------------------------

export function AgentPod({ entry, debate, loadedAt }: { entry: FleetEntry; debate: LiveDebate; loadedAt: string | null }) {
  const tone = INVESTIGATOR_VISUALS[entry.agent_id].tone;
  const lane = laneFor(debate.rounds, entry.agent_id);
  const credRow = [...debate.credibility].filter((row) => row.agent_id === entry.agent_id).sort((a, b) => a.round - b.round);
  const crsBefore = credRow.length > 0 ? credRow[0].crs_before : null;
  const crsAfter = credRow.length > 0 ? credRow[credRow.length - 1].crs_after : entry.crs.value;
  const stance = lane.latest?.stance ?? null;
  const confidences = lane.turns.map((turn) => turn.turn.confidence);
  const absence = laneAbsence(lane, entry.isolated, debate.status);
  const basis = debate.inputBasis[entry.agent_id];
  const basisWords = basis ? INPUT_BASIS_LABEL[basis.basis] : undefined;

  return (
    <div className={cn('relative flex flex-col rounded-xl border border-outline-variant/40 bg-surface-container-low p-4 shadow-lg transition-all', TONE_HOVER[tone])}>
      <div className="mb-3 flex items-center justify-between border-b border-outline-variant/30 pb-2">
        <div className="flex items-center gap-2.5">
          <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg border font-mono text-base font-bold', TONE_GLYPH_BOX[tone])}>
            {AGENT_VISUALS[entry.agent_id].glyph}
          </div>
          <div className="flex flex-col">
            <span className="font-headline text-base font-semibold leading-none text-on-surface">{entry.display_name}</span>
            <span className={cn('mt-1 font-mono text-[10px] font-semibold uppercase', TONE_TEXT[tone])}>{entry.domain}</span>
          </div>
        </div>
        {entry.isolated ? (
          <span className={cn('inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] uppercase', TONE_PILL.error)}>
            <Icon name="warning" size={12} /> isolated
          </span>
        ) : (
          <span className="rounded border border-outline-variant/30 bg-surface-container-high px-2 py-0.5 font-mono text-[10px] uppercase text-on-surface-variant">
            active
          </span>
        )}
      </div>

      {absence !== null ? (
        <div
          role="note"
          className={cn(
            'mb-1 flex items-start gap-2 rounded-lg border p-3 font-body text-xs leading-relaxed',
            absence === 'quarantined' ? TONE_PILL.error : TONE_PILL.neutral,
          )}
        >
          <Icon name={absence === 'quarantined' ? 'warning' : 'info'} size={16} className="mt-0.5 shrink-0" />
          <span>
            {absence === 'quarantined'
              ? 'Quarantined: did not take part in this debate'
              : 'Did not take part in this debate: no transcript turns were recorded for this agent.'}
          </span>
        </div>
      ) : (
        <>
          {basis && basisWords && (
            <div className="mb-2 flex items-center justify-between gap-2 font-mono text-[10px] text-on-surface-variant">
              <span>
                Data slice: <strong className="text-on-surface">{basisWords.label}</strong> · {basis.row_count} row
                {basis.row_count === 1 ? '' : 's'}
              </span>
              <Proof
                source="GET /investigations/{id} (input_basis)"
                n={basis.row_count}
                asOf={loadedAt}
                label={`Data slice, ${entry.display_name}`}
                definition={basisWords.detail}
              />
            </div>
          )}
          {/* Confidence trajectory */}
          <div className="mb-3 flex items-center justify-between rounded-lg border border-outline-variant/20 bg-background p-2 font-mono text-xs">
            <span className="text-[10px] text-on-surface-variant">Confidence trajectory</span>
            <span className="flex items-center gap-2">
              <span className="text-[11px] text-on-surface-variant line-through">{lane.firstConfidence === null ? '—' : PERCENT1(lane.firstConfidence)}</span>
              <span className={cn('font-bold', TONE_TEXT[tone])}>{lane.latestConfidence === null ? '—' : PERCENT1(lane.latestConfidence)}</span>
              <Proof
                source="GET /investigations/{id} (rounds[].agents[].confidence)"
                n={confidences.length}
                asOf={loadedAt}
                label="Confidence trajectory"
                definition="First-round to latest-round self-reported confidence for this agent. Self-reported, not calibrated accuracy (R4)."
              />
            </span>
          </div>

          {confidences.length > 0 && (
            <div className="mb-3">
              <Sparkline values={confidences} min={0} max={1} tone={tone} width={260} height={32} className="w-full" label="Confidence by round" />
            </div>
          )}

          {/* Theory + stance */}
          <div className="mb-3 flex flex-col gap-1">
            <span className={cn('font-mono text-[10px] font-bold uppercase tracking-wider', TONE_TEXT[tone])}>{stanceLabel(stance)}</span>
            <p className="rounded-lg border border-outline-variant/30 bg-surface-container p-2.5 font-body text-xs leading-relaxed text-on-surface">
              {lane.latest ? lane.latest.theory : 'No theory recorded for this agent yet.'}
            </p>
          </div>

          {/* Credibility + citations */}
          <div className="mt-auto flex items-center justify-between border-t border-outline-variant/30 pt-2 font-mono text-[10px] text-on-surface-variant">
            <span className="inline-flex items-center gap-1.5">
              <Ring value={crsAfter} tone={tone} size={28} strokeWidth={3} label={`Credibility, ${entry.display_name}`} />
              Credibility (CrS) {crsBefore === null ? '—' : PERCENT1(crsBefore)} →{' '}
              <span className={TONE_TEXT[tone]}>{crsAfter === null ? '—' : PERCENT1(crsAfter)}</span>
              <Proof
                source="GET /investigations/{id} (credibility) · GET /agents/fleet (crs)"
                n={credRow.length}
                asOf={loadedAt}
                label="Credibility change"
                definition="crs_before of this agent's first scored round to crs_after of its latest scored round in this case. The ring shows the live fleet CrS."
              />
            </span>
            <span>
              {formatCountNoun(lane.citedCount, 'cited row', 'cited rows')}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
