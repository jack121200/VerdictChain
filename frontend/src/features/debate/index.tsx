import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  describeError,
  getAgentFleet,
  getEvidenceBundle,
  getInvestigation,
  getInvestigationCitations,
  getMe,
  getSettings,
  getSystemStatus,
  getWsTicket,
  signInvestigation,
} from '../../api/client';
import { connectInvestigationSocket, type InvestigationSocket } from '../../api/socket';
import type { LiveStatus } from '../../api/live-status';
import type {
  Citation,
  EvidenceBundleResponse,
  FleetEntry,
  InvestigationCitations,
  InvestigationDetail,
  InvestigatorId,
  Vote,
} from '../../api/types';
import { buildRoute } from '../../app/router';
import { useAsync } from '../../app/use-async';
import { AGENT_VISUALS } from '../../lib/agents';
import { cn } from '../../lib/cn';
import { meanSupporterConfidence, quorumFromVotes, verifyVerdictConfidence } from '../../lib/derive/verdict';
import { verifyEvidenceBundleHash } from '../../lib/derive/hash';
import { formatCount, formatCountNoun, formatPercent, formatSignedPercent, shortId } from '../../lib/format';
import type { PageProps } from '../index';
import { DebateList } from './List';
import { QueueBanner } from './QueueBanner';
import { Button } from '../../ui/Button';
import { HintStrip } from '../../ui/HintStrip';
import { Timestamp } from '../../ui/Timestamp';
import type { Tone } from '../../ui/classes';
import { CopyHash } from '../../ui/CopyHash';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { Proof } from '../../ui/Proof';
import { Ring } from '../../ui/Ring';
import { Skeleton } from '../../ui/Skeleton';
import { Sparkline } from '../../ui/Sparkline';
import { pushToast } from '../../ui/toast-store';
import {
  applyFrame,
  citationMeta,
  earliestCitedTimestamp,
  emptyDebate,
  INPUT_BASIS_LABEL,
  fromDetail,
  laneAbsence,
  laneFor,
  mostCitedValue,
  providersUsed,
  roundBadge,
  roundSteps,
  stanceLabel,
  stanceTone,
  VERDICT_LABEL,
  verdictTone,
  type LiveDebate,
} from './derive';

const AGENT_TONE: Record<InvestigatorId, Tone> = {
  network_traffic: 'primary',
  access_log: 'secondary',
  endpoint_behavior: 'tertiary',
};

const TONE_TEXT: Record<Tone, string> = {
  primary: 'text-primary',
  secondary: 'text-secondary',
  tertiary: 'text-tertiary',
  error: 'text-error',
};

const TONE_GLYPH_BOX: Record<Tone, string> = {
  primary: 'bg-primary/10 border-primary/30 text-primary',
  secondary: 'bg-secondary/10 border-secondary/30 text-secondary',
  tertiary: 'bg-tertiary/10 border-tertiary/30 text-tertiary',
  error: 'bg-error-container/30 border-error/40 text-error',
};

const TONE_HOVER: Record<Tone, string> = {
  primary: 'hover:border-primary/50',
  secondary: 'hover:border-secondary/50',
  tertiary: 'hover:border-tertiary/50',
  error: 'hover:border-error/50',
};

const TONE_PILL: Record<Tone | 'neutral', string> = {
  neutral: 'border-outline-variant/40 bg-surface-container-high text-on-surface-variant',
  primary: 'border-primary/40 bg-primary/10 text-primary',
  secondary: 'border-secondary/40 bg-secondary/10 text-secondary',
  tertiary: 'border-tertiary/40 bg-tertiary/10 text-tertiary',
  error: 'border-error/40 bg-error-container/30 text-error',
};

const PERCENT1 = (value: number) => formatPercent(value, 1);

const ROOM_HINT = [
  'Read it top to bottom: the case banner and round progress, the Watchdog’s check of every cited row, one lane per investigator with its theory and credibility, the transcript, and the aggregator’s vote.',
  'Theories, confidence and stance come from the agents (confidence is self-reported, not accuracy); VERIFIED, DISCREPANCY and INVALID_ROW are the Watchdog’s own result from re-reading raw_logs.',
  'The verdict confidence is recomputed in your browser from the votes and compared with the server’s value; a finished case is replayed from stored rows, with no call to a model provider.',
] as const;
const DEFAULT_TOTAL_ROUNDS = 3;

type RoundFilter = 'all' | number;

/** Debate Room (plan 2.5): live while running, replay when finished. Every value is an API field or a Proof-documented derivation. */
/** Routes to the live debate list when no investigation id is in the URL, else the room. */
export default function DebatePage({ id }: PageProps) {
  return id ? <DebateRoom id={id} /> : <DebateList />;
}

function DebateRoom({ id }: { id: string }) {
  const investigationId = id;

  const [debate, setDebate] = useState<LiveDebate>(emptyDebate());
  const [meta, setMeta] = useState<InvestigationDetail | null>(null);
  const [citations, setCitations] = useState<InvestigationCitations | null>(null);
  const [bundle, setBundle] = useState<EvidenceBundleResponse | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [wsState, setWsState] = useState<LiveStatus['state'] | null>(null);
  const [roundFilter, setRoundFilter] = useState<RoundFilter>('all');
  const [signBusy, setSignBusy] = useState(false);

  const fleet = useAsync(getAgentFleet, undefined, ['agents', 'credibility']);
  const settings = useAsync(getSettings, undefined, ['settings']);
  const status = useAsync(getSystemStatus, undefined, ['investigations', 'agents', 'settings', 'actions']);
  const me = useAsync(getMe);

  // Authoritative load of the investigation, its citations and its evidence bundle, keyed by id and reloadKey.
  useEffect(() => {
    if (investigationId === '') return;
    let cancelled = false;
    setLoadedAt(null);
    Promise.allSettled([
      getInvestigation(investigationId),
      getInvestigationCitations(investigationId),
      getEvidenceBundle(investigationId),
    ]).then(([detail, cites, bundleResult]) => {
      if (cancelled) return;
      if (detail.status === 'fulfilled') {
        setMeta(detail.value);
        setDebate(fromDetail(detail.value));
        setDetailError(null);
      } else {
        setDetailError(describeError(detail.reason));
      }
      setCitations(cites.status === 'fulfilled' ? cites.value : null);
      setBundle(bundleResult.status === 'fulfilled' ? bundleResult.value : null);
      setLoadedAt(new Date().toISOString());
    });
    return () => {
      cancelled = true;
    };
  }, [investigationId, reloadKey]);

  const handleFrame = useCallback((frame: Parameters<typeof applyFrame>[1]) => {
    setDebate((prev) => applyFrame(prev, frame));
    if (frame.type === 'verdict') setReloadKey((key) => key + 1);
    if (frame.type === 'error') pushToast(frame.detail, { tone: 'error' });
  }, []);

  const running = debate.status === 'investigating';
  const queued = debate.status === 'queued';
  const onLeftQueue = useCallback(() => setReloadKey((key) => key + 1), []);

  // Live feed only while the debate is running. Replay (a finished case) never opens a socket, so it triggers no provider call.
  useEffect(() => {
    if (investigationId === '' || !running) return;
    let socket: InvestigationSocket | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const { ticket } = await getWsTicket();
        if (cancelled) return;
        socket = connectInvestigationSocket(investigationId, ticket, {
          onFrame: handleFrame,
          onStatus: (live) => setWsState(live.state),
        });
      } catch {
        // The footer and status chip reflect the connection state; replay still works from the loaded detail.
      }
    })();
    return () => {
      cancelled = true;
      socket?.close();
    };
  }, [investigationId, running, handleFrame]);

  const totalRounds = settings.data?.debate_rounds ?? DEFAULT_TOTAL_ROUNDS;
  const activeAgentCount = fleet.data?.filter((entry) => !entry.isolated).length ?? 3;
  const steps = useMemo(
    () => roundSteps(debate.rounds, totalRounds, debate.status, activeAgentCount),
    [debate.rounds, totalRounds, debate.status, activeAgentCount],
  );

  const citationList = citations?.citations ?? [];
  const subject = mostCitedValue(citationList, 'user_id');
  const host = mostCitedValue(citationList, 'host_id');
  const triggerTime = earliestCitedTimestamp(citationList);
  const citedTotal = citations?.summary.total ?? 0;

  const agentName = useCallback(
    (agentId: InvestigatorId): string => fleet.data?.find((entry) => entry.agent_id === agentId)?.display_name ?? agentId,
    [fleet.data],
  );

  const domainName = meta?.primary_agent ? agentName(meta.primary_agent) : '—';
  const providers = providersUsed(debate.rounds);
  const configuredModels = [status.data?.providers.groq, status.data?.providers.gemini]
    .filter((provider): provider is NonNullable<typeof provider> => Boolean(provider?.configured && provider?.model))
    .map((provider) => provider.model as string);
  const engineText = providers.length > 0 ? providers.join(', ') : configuredModels.length > 0 ? configuredModels.join(', ') : 'per-call provider recorded with each turn';

  const quorum = quorumFromVotes(debate.votes, meta?.primary_agent ?? null);
  const supporters = debate.verdictClass ? meanSupporterConfidence(debate.votes, debate.verdictClass) : { value: null, n: 0 };
  const confidenceCheck = debate.verdictClass
    ? verifyVerdictConfidence(debate.verdictConfidence, debate.votes, debate.verdictClass)
    : 'not_checkable';
  const consensusThreshold = settings.data?.verdict_confidence_threshold ?? null;

  async function doSign() {
    setSignBusy(true);
    try {
      const result = await signInvestigation(investigationId);
      pushToast(`Sign-off recorded (audited). ${result.notice}`, { tone: 'secondary', durationMs: 6000 });
      setReloadKey((key) => key + 1);
    } catch (error) {
      pushToast(describeError(error), { tone: 'error' });
    } finally {
      setSignBusy(false);
    }
  }

  async function doExport() {
    if (!bundle) return;
    const matches = await verifyEvidenceBundleHash(bundle.bundle, bundle.bundle_sha256).catch(() => null);
    const payload = { evidence_bundle: bundle.bundle, bundle_sha256: bundle.bundle_sha256 };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${shortId(investigationId)}.evidence-bundle.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    const recompute = matches === null ? 'SHA-256 not recomputable here' : matches ? 'browser SHA-256 matches the server' : 'browser SHA-256 MISMATCH';
    pushToast(`Evidence bundle exported — ${recompute}.`, { tone: matches === false ? 'error' : 'secondary' });
  }

  const canSign = me.data?.capabilities.includes('sign_evidence_bundle') ?? false;
  const signable = debate.status === 'verdict_reached' || debate.status === 'contained' || debate.status === 'ambiguous';

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

        {/* 1. Case banner */}
        <section className="relative overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-low p-4 shadow-xl backdrop-blur-md sm:p-5">
          <div aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-linear-to-r from-primary via-secondary to-tertiary" />
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
                <span className={cn('rounded px-2 py-0.5 font-bold uppercase tracking-wider', TONE_PILL[verdictTone(debate.verdictClass)])}>
                  {debate.verdictClass ? VERDICT_LABEL[debate.verdictClass] : 'Adjudication in progress'}
                </span>
                {meta?.dataset && (
                  <span className="rounded border border-primary/30 bg-surface-container-high px-2 py-0.5 font-bold uppercase tracking-wider text-primary">
                    {meta.dataset}
                  </span>
                )}
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
                  Consensus target: <span className="text-on-surface">{consensusThreshold === null ? '—' : PERCENT1(consensusThreshold)}</span> · deterministic vote
                </span>
                <Proof
                  source="GET /settings (verdict_confidence_threshold)"
                  n={1}
                  asOf={settings.loadedAt}
                  label="Consensus target"
                  definition="The verdict confidence threshold from runtime settings. A verdict stands when the aggregated supporter confidence meets it."
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
                        complete ? 'bg-secondary/20 text-secondary' : active ? 'animate-pulse bg-primary-container text-on-primary' : 'bg-surface-container-high text-on-surface-variant',
                      )}
                    >
                      {complete ? <Icon name="check" size={16} /> : step.round}
                    </div>
                    <div className="flex min-w-0 flex-col">
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn('font-mono text-[10px] font-bold uppercase', complete ? 'text-secondary' : active ? 'text-primary' : 'text-on-surface-variant')}>
                          Round {step.round} : {complete ? 'complete' : active ? 'active' : 'pending'}
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
                definition="A round is complete when every active agent has a transcript turn in it (or a later round exists, or the debate finished). The first incomplete round while running is active."
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
            quorumTone={quorum.status === 'agreed' || quorum.status === 'primary_decided' ? 'secondary' : quorum.status === 'no_votes' ? 'neutral' : 'tertiary'}
            supporters={supporters}
            confidenceCheck={confidenceCheck}
            consensusThreshold={consensusThreshold}
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

// ---- agent pod -------------------------------------------------------------------

function AgentPod({ entry, debate, loadedAt }: { entry: FleetEntry; debate: LiveDebate; loadedAt: string | null }) {
  const tone = AGENT_TONE[entry.agent_id];
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
              CrS {crsBefore === null ? '—' : PERCENT1(crsBefore)} →{' '}
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

// ---- transcript ------------------------------------------------------------------

interface TranscriptProps {
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

function Transcript({ rounds, filter, onFilter, totalRounds, agentName, running, wsState, onExport, canExport, loadedAt }: TranscriptProps) {
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
            const tone = AGENT_TONE[agent.agent_id];
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

// ---- aggregator ------------------------------------------------------------------

interface AggregatorProps {
  debate: LiveDebate;
  quorumLabel: string;
  quorumTone: Tone | 'neutral';
  supporters: { value: number | null; n: number };
  confidenceCheck: 'match' | 'mismatch' | 'not_checkable';
  consensusThreshold: number | null;
  citedTotal: number;
  agentName: (agentId: InvestigatorId) => string;
  canSign: boolean;
  signable: boolean;
  signBusy: boolean;
  onSign: () => void;
  investigationId: string;
  loadedAt: string | null;
}

function Aggregator({
  debate,
  quorumLabel,
  quorumTone,
  supporters,
  confidenceCheck,
  consensusThreshold,
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
  const delta = supporters.value !== null && consensusThreshold !== null ? supporters.value - consensusThreshold : null;

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
              threshold {consensusThreshold === null ? '—' : PERCENT1(consensusThreshold)}
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
              <Icon name="receipt_long" size={20} className={TONE_TEXT[vTone === 'neutral' ? 'secondary' : vTone]} />
              <span className="font-mono text-[10px] font-bold uppercase text-on-surface">{debate.status ?? '—'}</span>
            </div>
          </Ring>
        </div>

        {/* Votes table (replaces the invented weights equation) */}
        <div className="flex flex-col gap-1.5 rounded-lg border border-outline-variant/30 bg-background p-3 font-mono text-[10px]">
          <div className="flex items-center justify-between">
            <span className="font-bold uppercase text-on-surface-variant">Per-agent votes</span>
            <Proof
              source="GET /investigations/{id} (votes)"
              n={debate.votes.length}
              asOf={loadedAt}
              label="Per-agent votes"
              definition="Each agent's server-classified verdict class, its self-reported confidence and the keywords matched by classify_theory. An agent the Watchdog isolated during the investigation is shown but not counted (counted: false). There are no vote weights in the system."
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
                </span>
              </div>
            ))
          )}
        </div>

        {/* Final verdict */}
        <div className={cn('flex flex-col gap-1 rounded-lg border p-3', debate.verdictClass && vTone === 'error' ? 'border-error/40 bg-error-container/20 shadow-glow-crimson' : 'border-outline-variant/40 bg-background')}>
          <div className="flex items-center gap-1.5">
            <Icon name={vTone === 'error' ? 'warning' : 'check_circle'} size={16} className={TONE_TEXT[vTone === 'neutral' ? 'secondary' : vTone]} />
            <span className={cn('font-mono text-[10px] font-bold uppercase tracking-wider', TONE_TEXT[vTone === 'neutral' ? 'secondary' : vTone])}>Final synthesised verdict</span>
          </div>
          <p className="font-headline text-base font-bold uppercase leading-tight text-on-surface">
            {debate.verdictClass ? VERDICT_LABEL[debate.verdictClass] : 'No verdict yet'}
          </p>
          <p className="font-mono text-[11px] text-on-surface-variant">
            class <span className="text-on-surface">{debate.verdictClass ?? '—'}</span> · status{' '}
            <span className="text-on-surface">{debate.status ?? '—'}</span> · {formatCountNoun(supporters.n, 'supporter')} · {formatCountNoun(citedTotal, 'cited row', 'cited rows')}
          </p>
        </div>

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

// ---- cited artifacts -------------------------------------------------------------

function CitedArtifacts({
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
                    <td className={cn('p-2.5 font-semibold', TONE_TEXT[AGENT_TONE[citation.agent_id]])}>
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
