import { cn } from '../../lib/cn';
import { formatCountNoun, shortId } from '../../lib/format';
import type { PageProps } from '../index';
import { DebateList } from './List';
import { FailureBanner } from './FailureBanner';
import { QueueBanner } from './QueueBanner';
import { HintStrip } from '../../ui/HintStrip';
import { Timestamp } from '../../ui/Timestamp';
import { CopyHash } from '../../ui/CopyHash';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { Proof } from '../../ui/Proof';
import { Skeleton } from '../../ui/Skeleton';
import { StubBadge } from '../../ui/StubBadge';
import { citationMeta, VERDICT_LABEL, verdictTone } from './derive';
import { PERCENT1, TONE_PILL } from './shared';
import { AgentPod } from './AgentPod';
import { Transcript } from './Transcript';
import { Aggregator } from './Aggregator';
import { CitedArtifacts } from './CitedArtifacts';
import { useDebateRoom } from './useDebateRoom';

const ROOM_HINT = [
  'Read it top to bottom: the case banner and round progress, the Watchdog’s check of every cited row, one lane per investigator with its theory and credibility, the transcript, and the aggregator’s vote.',
  'Theories, confidence and stance come from the agents (confidence is self-reported, not accuracy); VERIFIED, DISCREPANCY and INVALID_ROW are the Watchdog’s own result from re-reading raw_logs.',
  'The verdict confidence is recomputed in your browser from the votes and compared with the server’s value; a finished case is replayed from stored rows, with no call to a model provider.',
] as const;

/** Debate Room (plan 2.5): live while running, replay when finished. Every value is an API field or a Proof-documented derivation. */
/** Routes to the live debate list when no investigation id is in the URL, else the room. */
export default function DebatePage({ id }: PageProps) {
  return id ? <DebateRoom id={id} /> : <DebateList />;
}

function DebateRoom({ id }: { id: string }) {
  const { investigationId, detailError, meta, queued, onLeftQueue, failed, debate, bundle, domainName, citedTotal, subject, host, triggerTime, loadedAt, engineText, providers, consensusThreshold, settings, steps, citationList, fleet, roundFilter, setRoundFilter, totalRounds, agentName, running, wsState, doExport, quorum, supporters, confidenceCheck, canSign, signable, signBusy, doSign, citations } = useDebateRoom(id);

  if (investigationId === '') {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-6">
        <EmptyState title="No investigation selected" description="Open a debate from the dashboard ledger or the investigations list." />
      </div>
    );
  }

  if (detailError !== null && meta === null) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-6">
        <EmptyState icon="warning" title="Could not load this debate" description={detailError} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-6">
      <div className="flex w-full flex-col gap-4 text-on-surface">
        <HintStrip pageId="debate-room" sentences={ROOM_HINT} />

        {queued && <QueueBanner investigationId={investigationId} onLeftQueue={onLeftQueue} />}
        {failed && <FailureBanner investigationId={investigationId} reason={debate.errorReason} />}

        {/* 1. Case banner */}
        <section className="relative overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-low p-4 shadow-xl backdrop-blur-md sm:p-5">
          <div aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-linear-to-r from-primary via-secondary to-tertiary" />
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
                <span className={cn('rounded px-2 py-0.5 font-bold uppercase tracking-wider', TONE_PILL[verdictTone(debate.verdictClass)])}>
                  {debate.verdictClass ? VERDICT_LABEL[debate.verdictClass] : failed ? 'Debate stopped' : 'Adjudication in progress'}
                </span>
                {meta?.dataset && (
                  <span className="rounded border border-primary/30 bg-surface-container-high px-2 py-0.5 font-bold uppercase tracking-wider text-primary">
                    {meta.dataset}
                  </span>
                )}
                <StubBadge source={meta?.data_source} />
                {bundle && (
                  <span className="inline-flex items-center gap-1 text-on-surface-variant">
                    bundle <CopyHash value={bundle.bundle_sha256} label="Evidence bundle SHA-256" />
                  </span>
                )}
                <span className="relative inline-flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-1.5 w-1.5 animate-ping rounded-full bg-secondary opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-secondary" />
                </span>
                <span className="inline-flex items-center gap-1 uppercase tracking-widest text-secondary">
                  Blind test enforced
                  <Proof
                    source="backend/tests/agents/test_blind_boundary.py"
                    n={1}
                    asOf={null}
                    label="Blind test"
                    definition="The ground-truth scenario label never reaches an investigator's input. Checked by an AST scan, a seeded-secret test and a prompt test (plan R9)."
                  />
                </span>
              </div>

              <h1 className="font-headline text-2xl font-bold tracking-tight text-on-surface sm:text-3xl">
                {debate.verdictClass ? VERDICT_LABEL[debate.verdictClass] : 'Multi-agent adjudication'} · {domainName} · {formatCountNoun(citedTotal, 'cited row', 'cited rows')}
              </h1>

              <p className="flex flex-wrap items-center gap-2 font-body text-xs text-on-surface-variant sm:text-sm">
                <span className="inline-flex items-center gap-1">
                  case{' '}
                  <CopyHash value={investigationId} display={shortId(investigationId)} label="investigation id" size="inherit" textClassName="text-primary" className="font-mono" />
                </span>
                <span className="text-outline-variant">•</span>
                <span className="inline-flex items-center gap-1">
                  subject <strong className="font-mono text-error">{subject ?? '—'}</strong>
                </span>
                <span className="text-outline-variant">•</span>
                <span className="inline-flex items-center gap-1">
                  host <strong className="font-mono text-primary">{host ?? '—'}</strong>
                </span>
                <span className="text-outline-variant">•</span>
                <span className="inline-flex items-center gap-1">
                  trigger <span className="font-mono text-on-surface">{meta?.trigger_type ?? '—'}</span>
                  {triggerTime && (
                    <span className="font-mono text-on-surface-variant">
                      · <Timestamp iso={triggerTime} mode="absolute" />
                    </span>
                  )}
                </span>
                <Proof
                  source="GET /investigations/{id} · GET /investigations/{id}/citations"
                  n={citedTotal}
                  asOf={loadedAt}
                  label="Case attribution"
                  definition="Title = verdict class label · primary-agent domain · cited-row count. Subject and host are the most-cited user_id and host_id across VERIFIED citations (a tie is broken by the lexicographically smallest value); trigger is the stored trigger_type and the earliest verified cited timestamp. No case number is invented."
                />
              </p>
            </div>

            {/* Engine / verifier metadata */}
            <div className="flex shrink-0 flex-col items-start gap-1 rounded-lg border border-outline-variant/40 bg-background p-3 font-mono text-[11px] lg:items-end">
              <div className="flex items-center gap-2">
                <Icon name="hub" size={16} className="text-primary" />
                <span className="text-on-surface">
                  Engine: <span className="font-bold text-primary">{engineText}</span>
                </span>
                <Proof
                  source="GET /investigations/{id} (transcript providers) · GET /system/status (providers)"
                  n={providers.length}
                  asOf={loadedAt}
                  label="Engine"
                  definition="The distinct per-call providers persisted with this debate's transcript turns, else the configured provider models from system status. No tokens-per-second figure is shown."
                />
              </div>
              <div className="flex items-center gap-1.5">
                <Icon name="verified_user" size={16} className="text-secondary" />
                <span className="font-bold uppercase text-secondary">Watchdog</span>
                <span className="text-on-surface-variant">deterministic, no LLM</span>
              </div>
              <div className="flex items-center gap-1.5 text-on-surface-variant">
                <span>
                  Containment floor: <span className="text-on-surface">{consensusThreshold === null ? '—' : PERCENT1(consensusThreshold)}</span> · deterministic vote
                </span>
                <Proof
                  source="GET /settings (verdict_confidence_threshold)"
                  n={1}
                  asOf={settings.loadedAt}
                  label="Containment floor"
                  definition="The verdict confidence threshold from runtime settings. Self-Healing contains the case only when the verdict is a threat class, its confidence reaches this floor and every contributing agent's CrS is at least 50 %. A verdict below it still stands; it is not contained. The class itself comes from the vote."
                />
              </div>
            </div>
          </div>

          {/* Round stepper */}
          <div className="mt-4 border-t border-outline-variant/30 pt-3">
            <div className="grid grid-cols-1 items-center gap-3 md:grid-cols-3">
              {steps.map((step) => {
                const complete = step.state === 'complete';
                const active = step.state === 'active';
                const stopped = step.state === 'stopped';
                return (
                  <div
                    key={step.round}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border p-2.5',
                      active
                        ? 'border-primary-container/40 bg-primary-container/15 shadow-glow-cyan'
                        : 'border-outline-variant/30 bg-surface-container/60',
                    )}
                  >
                    <div
                      className={cn(
                        'flex h-7 w-7 items-center justify-center rounded-full font-mono text-xs font-bold',
                        complete ? 'bg-secondary/20 text-secondary' : active ? 'animate-pulse bg-primary-container text-on-primary' : stopped ? 'bg-error-container/40 text-error' : 'bg-surface-container-high text-on-surface-variant',
                      )}
                    >
                      {complete ? <Icon name="check" size={16} /> : stopped ? <Icon name="cancel" size={16} /> : step.round}
                    </div>
                    <div className="flex min-w-0 flex-col">
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn('font-mono text-[10px] font-bold uppercase', complete ? 'text-secondary' : active ? 'text-primary' : stopped ? 'text-error' : 'text-on-surface-variant')}>
                          Round {step.round} : {complete ? 'complete' : active ? 'active' : stopped ? `stopped · ${step.answered} of ${step.expected} answered` : 'pending'}
                        </span>
                      </div>
                      <span className="truncate font-body text-xs text-on-surface">{step.title}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex items-center justify-end">
              <Proof
                source="GET /investigations/{id} (rounds) · GET /settings (debate_rounds)"
                n={debate.rounds.length}
                asOf={loadedAt}
                label="Round progress"
                definition="A round is complete when every active agent has a transcript turn in it (or a later round exists, or the debate finished). The first incomplete round while running is active. When the debate stopped with an error, the round that was cut off is stopped and says how many agents had answered."
              />
            </div>
          </div>
        </section>

        {/* 2. Watchdog grounding strip */}
        <section className="flex flex-col items-start justify-between gap-3 rounded-xl border border-outline-variant/40 bg-background p-3 shadow-md md:flex-row md:items-center">
          <div className="flex shrink-0 items-center gap-2">
            <span className="relative inline-flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-2.5 w-2.5 animate-ping rounded-full bg-secondary opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-secondary" />
            </span>
            <span className="inline-flex items-center gap-1 font-mono text-xs font-bold uppercase tracking-wider text-secondary">
              <Icon name="verified_user" size={16} />
              Watchdog grounding verification
            </span>
            <Proof
              source="GET /investigations/{id}/citations"
              n={citedTotal}
              asOf={loadedAt}
              label="Watchdog grounding"
              definition="Each cited row is re-checked against raw_logs. VERIFIED, DISCREPANCY or INVALID_ROW is the Watchdog's deterministic result per citation."
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
            {citationList.length === 0 ? (
              <span className="text-on-surface-variant">No citations checked yet.</span>
            ) : (
              citationList.slice(0, 5).map((citation, index) => {
                const metaCitation = citationMeta(citation.status);
                return (
                  <span key={`${citation.row_id}-${citation.field}-${index}`} className={cn('inline-flex items-center gap-1 rounded border px-2 py-1', TONE_PILL[metaCitation.tone])}>
                    <Icon name={metaCitation.icon} size={12} />
                    <span>
                      row {citation.row_id}: {metaCitation.label}
                    </span>
                  </span>
                );
              })
            )}
          </div>
        </section>

        {/* 3. Agent lanes */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {fleet.data === undefined ? (
            <>
              <Skeleton className="h-64 w-full" />
              <Skeleton className="h-64 w-full" />
              <Skeleton className="h-64 w-full" />
            </>
          ) : (
            fleet.data.map((entry) => <AgentPod key={entry.agent_id} entry={entry} debate={debate} loadedAt={loadedAt} />)
          )}
        </section>

        {/* 4. Transcript + aggregator */}
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <Transcript
            rounds={debate.rounds}
            filter={roundFilter}
            onFilter={setRoundFilter}
            totalRounds={totalRounds}
            agentName={agentName}
            running={running}
            wsState={wsState}
            onExport={doExport}
            canExport={bundle !== null}
            loadedAt={loadedAt}
          />
          <Aggregator
            debate={debate}
            quorumLabel={quorum.label}
            quorumTone={quorum.tone}
            supporters={supporters}
            confidenceCheck={confidenceCheck}
            consensusThreshold={consensusThreshold}
            credibilityFloor={settings.data?.starting_crs ?? null}
            citedTotal={citedTotal}
            agentName={agentName}
            canSign={canSign}
            signable={signable}
            signBusy={signBusy}
            onSign={doSign}
            investigationId={investigationId}
            loadedAt={loadedAt}
          />
        </section>

        {/* 5. Cited forensic artifacts */}
        <CitedArtifacts citations={citationList} agentName={agentName} loading={citations === null && detailError === null} loadedAt={loadedAt} />
      </div>
    </div>
  );
}
