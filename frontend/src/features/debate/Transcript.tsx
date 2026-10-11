/** The Debate Room transcript, filtered by round, with the export. */
import type { LiveStatus } from '../../api/live-status';
import type { InvestigatorId } from '../../api/types';
import { AGENT_VISUALS, INVESTIGATOR_VISUALS } from '../../lib/agents';
import { cn } from '../../lib/cn';
import { formatCountNoun } from '../../lib/format';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { Proof } from '../../ui/Proof';
import { roundBadge, stanceLabel, stanceTone, type LiveDebate } from './derive';
import { RoundFilter, TONE_GLYPH_BOX, TONE_PILL } from './shared';

// ---- transcript ------------------------------------------------------------------

export interface TranscriptProps {
  rounds: LiveDebate['rounds'];
  filter: RoundFilter;
  onFilter: (filter: RoundFilter) => void;
  totalRounds: number;
  agentName: (agentId: InvestigatorId) => string;
  running: boolean;
  wsState: LiveStatus['state'] | null;
  onExport: () => void;
  canExport: boolean;
  loadedAt: string | null;
}

export function Transcript({ rounds, filter, onFilter, totalRounds, agentName, running, wsState, onExport, canExport, loadedAt }: TranscriptProps) {
  const roundNumbers = Array.from({ length: totalRounds }, (_, index) => index + 1);
  const visibleRounds = filter === 'all' ? rounds : rounds.filter((round) => round.round === filter);
  const turns = visibleRounds
    .flatMap((round) => round.agents.map((agent) => ({ round: round.round, agent })))
    .sort((a, b) => a.round - b.round);

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-low shadow-xl xl:col-span-7">
      <div className="flex flex-col justify-between gap-3 border-b border-outline-variant/40 bg-surface-card p-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <Icon name="menu_book" size={20} className="text-primary" />
          <span className="font-headline text-base font-bold text-on-surface">Deliberation protocol stream</span>
        </div>
        <div className="inline-flex gap-1 rounded-lg border border-outline-variant/40 bg-background p-1 font-mono text-[10px]">
          {roundNumbers.map((round) => (
            <button
              key={round}
              type="button"
              onClick={() => onFilter(round)}
              aria-pressed={filter === round}
              className={cn('cursor-pointer rounded px-3 py-1 uppercase transition-all', filter === round ? 'bg-primary-container font-bold text-on-primary shadow-md' : 'text-on-surface-variant hover:text-on-surface')}
            >
              R{round}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onFilter('all')}
            aria-pressed={filter === 'all'}
            className={cn('cursor-pointer rounded px-3 py-1 uppercase transition-all', filter === 'all' ? 'bg-primary-container font-bold text-on-primary shadow-md' : 'text-on-surface-variant hover:text-on-surface')}
          >
            All
          </button>
        </div>
      </div>

      <div className="flex max-h-[560px] flex-col gap-3 overflow-y-auto p-4">
        {turns.length === 0 ? (
          <EmptyState title="No turns in this round yet" description="Transcript turns appear per round as each investigator posts its theory." />
        ) : (
          turns.map(({ round, agent }) => {
            const tone = INVESTIGATOR_VISUALS[agent.agent_id].tone;
            const sTone = stanceTone(agent.stance);
            return (
              <div key={`${round}-${agent.agent_id}`} className="flex flex-col gap-1.5 rounded-lg border border-outline-variant/30 bg-background/80 p-3.5 transition-all">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={cn('flex h-6 w-6 items-center justify-center rounded border font-mono text-xs font-bold', TONE_GLYPH_BOX[tone])}>
                      {AGENT_VISUALS[agent.agent_id].glyph}
                    </span>
                    <span className="font-mono text-xs font-bold text-on-surface">{agentName(agent.agent_id)}</span>
                    <span className="font-mono text-[10px] text-on-surface-variant">• round {round}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={cn('rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase', TONE_PILL.primary)}>{roundBadge(round)}</span>
                    <span className={cn('rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase', TONE_PILL[sTone])}>{stanceLabel(agent.stance)}</span>
                  </div>
                </div>
                <p className="font-body text-xs leading-relaxed text-on-surface sm:text-sm">{agent.theory}</p>
                <div className="flex items-center gap-1.5 border-t border-outline-variant/20 pt-1 font-mono text-[10px] text-on-surface-variant">
                  <Icon name="verified_user" size={12} className="text-secondary" />
                  <span>
                    {formatCountNoun(agent.cited_evidence.length, 'cited row', 'cited rows')}
                    {agent.cited_evidence.length > 0 && <>: {agent.cited_evidence.map((cite) => `#${cite.row_id}`).join(', ')}</>}
                    {agent.provider && <span className="text-outline"> · {agent.provider}</span>}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-outline-variant/30 bg-background p-3 font-mono text-[10px]">
        <div className="flex items-center gap-2 text-on-surface-variant">
          {running ? (
            <>
              <Icon name="sync_alt" size={16} className="animate-spin text-primary" />
              <span>Live debate in progress{wsState ? ` · socket ${wsState}` : ''}</span>
            </>
          ) : (
            <>
              <Icon name="check_circle" size={16} className="text-secondary" />
              <span>Replaying stored transcript · no provider call</span>
            </>
          )}
        </div>
        <span className="inline-flex items-center gap-1.5">
          <Button variant="secondary" size="sm" icon="receipt_long" onClick={onExport} disabled={!canExport}>
            Export proof JSON
          </Button>
          <Proof
            source="GET /investigations/{id}/evidence-bundle"
            n={1}
            asOf={loadedAt}
            label="Export proof"
            definition="Downloads the canonical evidence bundle and its SHA-256 as JSON. The browser recomputes the SHA-256 over the bundle and reports whether it matches the server."
          />
        </span>
      </div>
    </div>
  );
}
