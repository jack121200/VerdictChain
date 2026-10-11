/** The three investigator pods (also used by the landing page). */
import type { DebateRound, FleetEntry, InvestigationDetail, InvestigatorId, Metric as MetricEnvelope } from '../../api/types';
import { INVESTIGATOR_VISUALS } from '../../lib/agents';
import { cn } from '../../lib/cn';
import { formatCountNoun } from '../../lib/format';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { Proof } from '../../ui/Proof';
import { Ring } from '../../ui/Ring';
import { Skeleton } from '../../ui/Skeleton';
import { Sparkline } from '../../ui/Sparkline';
import { PERCENT0, PERCENT1, Stat, TONE_GLYPH_BOX, TONE_HOVER, TONE_TEXT } from './shared';

// ---- 3. Investigator pod triad ----------------------------------------------------

export function agentTurnsAcrossRounds(rounds: readonly DebateRound[], agentId: InvestigatorId) {
  return [...rounds]
    .sort((a, b) => a.round - b.round)
    .map((round) => ({ round: round.round, turn: round.agents.find((turn) => turn.agent_id === agentId) }))
    .filter((entry): entry is { round: number; turn: NonNullable<(typeof entry)['turn']> } => entry.turn !== undefined);
}

export function stanceLabel(stance: string | null): string {
  return stance ?? 'stance not stated';
}

export function stanceToneText(stance: string | null): string {
  if (stance === 'SUPPORT') return 'text-secondary';
  if (stance === 'CHALLENGE') return 'text-tertiary';
  if (stance === 'REVISE') return 'text-primary';
  return 'text-on-surface-variant';
}

export function Pod({ entry, detail }: { entry: FleetEntry; detail: InvestigationDetail | undefined }) {
  const agentId = entry.agent_id;
  const tone = INVESTIGATOR_VISUALS[agentId].tone;
  const turns = detail ? agentTurnsAcrossRounds(detail.rounds, agentId) : [];
  const latest = turns.length > 0 ? turns[turns.length - 1] : null;
  const confidences = turns.map((entry) => entry.turn.confidence);

  return (
    <div className={cn('flex flex-col justify-between rounded-xl border border-outline-variant/40 bg-surface-card p-4 shadow-xl transition-all', TONE_HOVER[tone])}>
      <div>
        <div className="mb-3 flex items-center justify-between border-b border-outline-variant/30 pb-3">
          <div className="flex items-center gap-2.5">
            <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg border font-mono text-base font-bold', TONE_GLYPH_BOX[tone])}>
              {INVESTIGATOR_VISUALS[agentId].glyph}
            </span>
            <div>
              <div className="font-headline text-base font-bold text-on-surface">{entry.display_name}</div>
              <div className="font-mono text-[10px] text-on-surface-variant">{entry.domain}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-right">
            <Ring value={entry.crs.value} tone={tone} size={44} strokeWidth={4} label={`Credibility, ${entry.display_name}`}>
              <span className={cn('font-mono text-[10px] font-bold', TONE_TEXT[tone])}>
                {entry.crs.value === null ? '—' : PERCENT0(entry.crs.value)}
              </span>
            </Ring>
            <div>
              <Stat metric={entry.crs} className={cn('font-headline text-lg font-bold', TONE_TEXT[tone])} format={PERCENT1} label={`Credibility, ${entry.display_name}`} />
              <div className="font-mono text-[9px] uppercase text-on-surface-variant">Credibility</div>
            </div>
          </div>
        </div>

        <div className="mb-3 rounded-lg border border-outline-variant/30 bg-background p-3">
          <div className="mb-1 flex items-center justify-between font-mono text-[10px]">
            <span className="text-on-surface-variant">FORMAL STANCE</span>
            <span className={cn('font-semibold', stanceToneText(latest?.turn.stance ?? null))}>{stanceLabel(latest?.turn.stance ?? null)}</span>
          </div>
          {latest === null ? (
            <p className="font-body text-xs leading-relaxed text-on-surface-variant">No debate yet for this agent.</p>
          ) : (
            <p className="line-clamp-4 font-body text-xs leading-relaxed text-on-surface">{latest.turn.theory}</p>
          )}
          <div className="mt-2 flex items-center justify-between border-t border-outline-variant/20 pt-1.5 font-mono text-[9px] text-on-surface-variant">
            <span>
              Last vote: <span className="text-on-surface">{entry.last_vote ?? 'no vote'}</span>
            </span>
            <Proof
              source="GET /agents/fleet (last_vote) · GET /investigations/{id} (rounds)"
              n={turns.length}
              asOf={null}
              label="Formal stance"
              definition="The verdict class this agent voted in its latest scored debate (server classify_theory), plus the server-parsed stance prefix (SUPPORT / CHALLENGE / REVISE) of its latest theory."
            />
          </div>
        </div>

        <div className="space-y-1 rounded-lg border border-outline-variant/30 bg-surface-container-low p-2.5">
          <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-on-surface-variant">
            <span>Agent-reported confidence by round</span>
            <span className="inline-flex items-center gap-1">
              <span className={cn('font-semibold', TONE_TEXT[tone])}>{latest === null ? '—' : PERCENT1(latest.turn.confidence)}</span>
              <Proof
                source="GET /investigations/{id} (rounds[].agents[].confidence)"
                n={confidences.length}
                asOf={null}
                label="Confidence trajectory"
                definition="Self-reported confidence per round in this agent's latest investigation. Self-reported, not calibrated accuracy (R4)."
              />
            </span>
          </div>
          {confidences.length === 0 ? (
            <p className="font-mono text-[10px] text-on-surface-variant">no rounds yet</p>
          ) : (
            <Sparkline values={confidences} min={0} max={1} tone={tone} width={240} height={32} className="w-full" label="Confidence by round" />
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-outline-variant/20 pt-2 font-mono text-[10px] text-on-surface-variant">
        <span>
          Rounds scored: <Stat metric={entry.rounds_scored} className="text-on-surface" label="Rounds scored" />
        </span>
        {entry.isolated ? (
          <span className="flex items-center gap-1 font-semibold text-error">
            <Icon name="warning" size={12} /> Isolated
          </span>
        ) : (
          <span className="flex items-center gap-1 font-semibold text-secondary">
            <Icon name="verified_user" size={12} /> Active
          </span>
        )}
      </div>
    </div>
  );
}

export interface PodTriadProps {
  fleet: FleetEntry[] | undefined;
  detail: InvestigationDetail | undefined;
  meanCrs: MetricEnvelope<number> | undefined;
  /** Debate rounds from GET /settings, or undefined until it has loaded. */
  debateRounds?: number;
}

export function PodTriad({ fleet, detail, meanCrs, debateRounds }: PodTriadProps) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
          <span className="font-headline text-base font-semibold uppercase tracking-wider text-on-surface">Investigator pod triad</span>
          <span className="text-outline-variant">•</span>
          <span className="font-mono text-xs text-on-surface-variant">
            {debateRounds === undefined ? 'debate rounds —' : `${formatCountNoun(debateRounds, 'round')} of cross-examination`}
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded border border-secondary/30 bg-surface-card px-2.5 py-0.5 font-mono text-xs font-semibold text-secondary">
          Mean credibility <Stat metric={meanCrs} className="font-semibold text-secondary" format={PERCENT1} label="Mean fleet credibility" />
        </span>
      </div>

      {fleet === undefined ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      ) : fleet.length === 0 ? (
        <EmptyState title="No investigators reported" description="GET /agents/fleet returned no investigators." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {fleet.map((entry) => (
            <Pod key={entry.agent_id} entry={entry} detail={detail} />
          ))}
        </div>
      )}
    </section>
  );
}
