/** The Debate Room aggregator: the votes, the recomputed verdict confidence, the containment gate and the sign-off. */
import type { InvestigatorId, Vote } from '../../api/types';
import { buildRoute } from '../../app/router';
import { AGENT_VISUALS } from '../../lib/agents';
import { cn } from '../../lib/cn';
import { formatCount, formatCountNoun, formatSignedPercent } from '../../lib/format';
import { ContainmentGate } from './ContainmentGate';
import { containmentGate } from './gate';
import { Button } from '../../ui/Button';
import type { Tone } from '../../ui/classes';
import { Icon } from '../../ui/Icon';
import { Proof } from '../../ui/Proof';
import { Ring } from '../../ui/Ring';
import { VERDICT_LABEL, verdictTone, type LiveDebate } from './derive';
import { PERCENT1, TONE_PILL, TONE_TEXT } from './shared';

// ---- aggregator ------------------------------------------------------------------

export interface AggregatorProps {
  debate: LiveDebate;
  quorumLabel: string;
  quorumTone: Tone | 'neutral';
  supporters: { value: number | null; n: number };
  confidenceCheck: 'match' | 'mismatch' | 'not_checkable';
  consensusThreshold: number | null;
  credibilityFloor: number | null;
  citedTotal: number;
  agentName: (agentId: InvestigatorId) => string;
  canSign: boolean;
  signable: boolean;
  signBusy: boolean;
  onSign: () => void;
  investigationId: string;
  loadedAt: string | null;
}

export function Aggregator({
  debate,
  quorumLabel,
  quorumTone,
  supporters,
  confidenceCheck,
  consensusThreshold,
  credibilityFloor,
  citedTotal,
  agentName,
  canSign,
  signable,
  signBusy,
  onSign,
  investigationId,
  loadedAt,
}: AggregatorProps) {
  const vTone = verdictTone(debate.verdictClass);
  const stopped = debate.status === 'error';
  const delta = supporters.value !== null && consensusThreshold !== null ? supporters.value - consensusThreshold : null;
  const gate = containmentGate({
    status: debate.status,
    verdictClass: debate.verdictClass,
    verdictConfidence: debate.verdictConfidence,
    floor: consensusThreshold,
    credibilityFloor,
    votes: debate.votes,
    credibility: debate.credibility,
    actions: debate.actions,
    agentName,
  });

  return (
    <div className="flex flex-col gap-4 xl:col-span-5">
      <div className="flex flex-col gap-4 rounded-xl border border-outline-variant/40 bg-surface-container-low p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">Deterministic consensus</span>
            <h2 className="font-headline text-xl font-bold text-on-surface">Verdict aggregator</h2>
          </div>
          <span className={cn('inline-flex items-center gap-1 rounded border px-2.5 py-1 font-mono text-xs font-bold uppercase', TONE_PILL[quorumTone])}>
            <Icon name="verified_user" size={16} />
            {quorumLabel}
          </span>
        </div>

        {/* Calculated confidence + ring */}
        <div className="flex items-center justify-between gap-4 rounded-lg border border-outline-variant/40 bg-background p-4">
          <div className="flex flex-col">
            <span className="font-mono text-[10px] uppercase text-on-surface-variant">Calculated confidence</span>
            <span className={cn('font-headline text-4xl font-bold tracking-tight sm:text-5xl', supporters.value === null ? 'text-on-surface-variant' : TONE_TEXT[vTone === 'neutral' ? 'secondary' : vTone])}>
              {supporters.value === null ? '—' : PERCENT1(supporters.value)}
            </span>
            <span className="mt-1 inline-flex items-center gap-1.5 font-mono text-[10px] text-on-surface-variant">
              containment floor {consensusThreshold === null ? '—' : PERCENT1(consensusThreshold)}
              {delta !== null && (
                <strong className={delta >= 0 ? 'text-secondary' : 'text-error'}>({formatSignedPercent(delta, 1)})</strong>
              )}
              <Proof
                source="browser recompute of GET /investigations/{id} votes + verdict_confidence"
                n={supporters.n}
                asOf={loadedAt}
                label="Calculated confidence"
                definition="Mean of the supporting agents' self-reported confidence (browser recompute). It must equal the server verdict_confidence; a mismatch shows a red integrity badge. Agent-reported, not accuracy."
                inputs={[
                  { label: 'supporters (n)', value: formatCount(supporters.n) },
                  { label: 'server value', value: debate.verdictConfidence === null ? '—' : PERCENT1(debate.verdictConfidence) },
                  { label: 'browser recompute', value: confidenceCheck },
                ]}
              />
            </span>
            {confidenceCheck === 'match' && (
              <span className="mt-1 inline-flex w-fit items-center gap-1 rounded border border-secondary/40 bg-secondary/10 px-2 py-0.5 font-mono text-[10px] uppercase text-secondary">
                <Icon name="check" size={12} /> recompute matches server
              </span>
            )}
            {confidenceCheck === 'mismatch' && (
              <span className="mt-1 inline-flex w-fit items-center gap-1 rounded border border-error/40 bg-error-container/30 px-2 py-0.5 font-mono text-[10px] uppercase text-error">
                <Icon name="warning" size={12} /> recompute mismatch
              </span>
            )}
          </div>
          <Ring value={supporters.value} tone={vTone === 'neutral' ? 'secondary' : vTone} size={96} strokeWidth={8} label="Calculated verdict confidence">
            <div className="flex flex-col items-center">
              <Icon name="receipt_long" size={20} className={stopped ? TONE_TEXT.error : TONE_TEXT[vTone === 'neutral' ? 'secondary' : vTone]} />
              <span className="font-mono text-[10px] font-bold uppercase text-on-surface">{debate.status ?? '—'}</span>
            </div>
          </Ring>
        </div>

        {/* Votes table (replaces the invented weights equation) */}
        <div className="flex flex-col gap-1.5 rounded-lg border border-outline-variant/30 bg-background p-3 font-mono text-[10px]">
          <div className="flex items-center justify-between">
            <span className="font-bold uppercase text-on-surface-variant">{stopped ? 'Latest answers, classified (no vote was taken)' : 'Per-agent votes'}</span>
            <Proof
              source="GET /investigations/{id} (votes)"
              n={debate.votes.length}
              asOf={loadedAt}
              label="Per-agent votes"
              definition="Each agent's verdict class and its self-reported confidence. The class is the one the agent stated in its answer (vote_class); an answer stored before agents stated a class, or one that left it out, has its class read from the theory with a keyword list (classify_theory), and the row says so. A stated 'ambiguous' is an abstention and shows as no class. An agent the Watchdog isolated during the investigation is shown but not counted (counted: false). There are no vote weights in the system. When the debate stopped in error no vote was taken: the list is then each agent's latest stored answer, classified, and it is not a verdict."
            />
          </div>
          {debate.votes.length === 0 ? (
            <span className="text-on-surface-variant">No votes recorded yet.</span>
          ) : (
            debate.votes.map((vote: Vote) => (
              <div
                key={vote.agent_id}
                className={cn(
                  'flex items-center justify-between gap-2 border-t border-outline-variant/20 pt-1.5 first:border-t-0 first:pt-0',
                  vote.counted === false && 'opacity-60',
                )}
              >
                <span className="inline-flex items-center gap-1 text-on-surface">
                  <span className="font-bold">{AGENT_VISUALS[vote.agent_id].glyph}</span>
                  {agentName(vote.agent_id)}
                  {vote.counted === false && (
                    <span
                      title="The Watchdog isolated this agent during the investigation, so the verdict leaves its vote out."
                      className="ml-1 inline-flex items-center gap-0.5 rounded border border-error/40 px-1 text-[9px] font-bold uppercase text-error"
                    >
                      <Icon name="warning" size={10} />
                      not counted · isolated
                    </span>
                  )}
                </span>
                <span className={cn('text-on-surface-variant', vote.counted === false && 'line-through')}>
                  {vote.verdict_class ?? 'no class'}
                  {vote.confidence !== null && <span className="text-on-surface"> · {PERCENT1(vote.confidence)}</span>}
                  <span
                    title={
                      vote.class_source === 'stated'
                        ? 'The agent named this class itself in its answer.'
                        : 'The agent did not state a class, so the server read it from the theory text with a keyword list.'
                    }
                    className="ml-1 text-[9px] uppercase text-outline"
                  >
                    {vote.class_source === 'stated' ? 'stated' : 'read from text'}
                  </span>
                </span>
              </div>
            ))
          )}
        </div>

        {/* Final verdict */}
        <div className={cn('flex flex-col gap-1 rounded-lg border p-3', debate.verdictClass && vTone === 'error' ? 'border-error/40 bg-error-container/20 shadow-glow-crimson' : 'border-outline-variant/40 bg-background')}>
          <div className="flex items-center gap-1.5">
            <Icon name={stopped ? 'cancel' : vTone === 'error' ? 'warning' : 'check_circle'} size={16} className={stopped ? TONE_TEXT.error : TONE_TEXT[vTone === 'neutral' ? 'secondary' : vTone]} />
            <span className={cn('font-mono text-[10px] font-bold uppercase tracking-wider', stopped ? TONE_TEXT.error : TONE_TEXT[vTone === 'neutral' ? 'secondary' : vTone])}>{stopped ? 'Verdict' : 'Final synthesised verdict'}</span>
          </div>
          <p className="font-headline text-base font-bold uppercase leading-tight text-on-surface">
            {debate.verdictClass ? VERDICT_LABEL[debate.verdictClass] : stopped ? 'No verdict: the debate stopped' : 'No verdict yet'}
          </p>
          <p className="font-mono text-[11px] text-on-surface-variant">
            class <span className="text-on-surface">{debate.verdictClass ?? '—'}</span> · status{' '}
            <span className="text-on-surface">{debate.status ?? '—'}</span> · {formatCountNoun(supporters.n, 'supporter')} · {formatCountNoun(citedTotal, 'cited row', 'cited rows')}
          </p>
        </div>

        {/* Why the case was, or was not, contained */}
        <ContainmentGate gate={gate} loadedAt={loadedAt} />

        {/* Self-healing checklist */}
        <div className="flex flex-col gap-2 rounded-lg border border-outline-variant/30 bg-background p-3">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1 font-mono text-[10px] font-bold uppercase text-primary">
              <Icon name="sync_alt" size={12} />
              Self-healing sandbox actions
            </span>
            <span className={cn('rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase', debate.actions.length > 0 ? TONE_PILL.secondary : TONE_PILL.neutral)}>
              {debate.actions.length > 0 ? 'executed' : 'none'}
            </span>
          </div>
          <div className="flex flex-col gap-1.5 font-mono text-[10px]">
            {debate.actions.length === 0 ? (
              <span className="text-on-surface-variant">No containment actions for this case.</span>
            ) : (
              debate.actions.map((action) => (
                <div key={action.id} className="flex items-center justify-between gap-2 rounded border border-outline-variant/20 bg-surface-card p-2">
                  <span className="min-w-0 truncate text-on-surface">
                    <Icon name="check_circle" size={12} className="mr-1 inline text-secondary" />
                    {action.action_type} → {action.target}
                    {action.reason && <span className="text-on-surface-variant"> ({action.reason})</span>}
                  </span>
                  <span className={action.is_simulated ? 'text-secondary' : 'text-error'}>{action.is_simulated ? 'simulated' : 'NOT simulated'}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Commander actions */}
        <div className="flex flex-col gap-2 pt-1">
          <div className="flex items-center gap-2">
            <Button variant="primary" icon="receipt_long" onClick={onSign} busy={signBusy} disabled={!canSign || !signable || signBusy} className="flex-1">
              Record sign-off (audited)
            </Button>
            <Proof
              source="POST /investigations/{id}/sign (capability sign_evidence_bundle)"
              n={1}
              asOf={null}
              label="Record sign-off"
              definition="Records an audited acknowledgement of the evidence bundle in the hash-chained audit trail. This is not a cryptographic digital signature. Disabled without the capability or before a verdict."
            />
          </div>
          {!canSign && (
            <p className="inline-flex items-center gap-1.5 font-mono text-[10px] text-tertiary">
              <Icon name="error" size={12} /> Your role does not grant sign_evidence_bundle, so sign-off is disabled.
            </p>
          )}
          <a href={buildRoute({ name: 'investigation', id: investigationId })} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-outline-variant/60 bg-surface-container-high px-4 py-2 font-semibold text-on-surface transition-colors hover:bg-surface-bright">
            <Icon name="travel_explore" size={16} /> Open full dossier
          </a>
        </div>
      </div>
    </div>
  );
}
