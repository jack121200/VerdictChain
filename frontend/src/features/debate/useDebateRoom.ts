/** Everything the Debate Room loads and derives for one investigation: the stored case, the live socket, the verdict figures worked out in the browser, and the sign-off and export actions. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { describeError, getAgentFleet, getEvidenceBundle, getInvestigation, getInvestigationCitations, getMe, getSettings, getSystemStatus, getWsTicket, signInvestigation } from '../../api/client';
import { connectInvestigationSocket, type InvestigationSocket } from '../../api/socket';
import type { LiveStatus } from '../../api/live-status';
import type { EvidenceBundleResponse, InvestigationCitations, InvestigationDetail, InvestigatorId } from '../../api/types';
import { useAsync } from '../../app/use-async';
import { usePollWhile } from '../../app/use-poll-while';
import { meanSupporterConfidence, quorumFromVotes, verifyVerdictConfidence } from '../../lib/derive/verdict';
import { verifyEvidenceBundleHash } from '../../lib/derive/hash';
import { shortId } from '../../lib/format';
import { pushToast } from '../../ui/toast-store';
import { applyFrame, earliestCitedTimestamp, emptyDebate, fromDetail, mostCitedValue, providersUsed, quorumPill, roundSteps, type LiveDebate } from './derive';
import { DEFAULT_TOTAL_ROUNDS, POLL_WITHOUT_SOCKET_MS, RoundFilter } from './shared';

export function useDebateRoom(id: string) {
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
    if (frame.type === 'verdict' || frame.type === 'error') setReloadKey((key) => key + 1);
    if (frame.type === 'error') pushToast(frame.detail, { tone: 'error' });
  }, []);

  const running = debate.status === 'investigating';
  const queued = debate.status === 'queued';
  const failed = debate.status === 'error';
  const onLeftQueue = useCallback(() => setReloadKey((key) => key + 1), []);

  // The live socket is the fast path. While it is not open (a refused ticket, a dropped connection) a running case is
  // read again every few seconds, so the room never freezes on a debate that has already ended.
  usePollWhile(running && wsState !== 'open', POLL_WITHOUT_SOCKET_MS, () => setReloadKey((key) => key + 1));

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
  const configuredModels = [status.data?.providers.openai]
    .filter((provider): provider is NonNullable<typeof provider> => Boolean(provider?.configured && provider?.model))
    .map((provider) => provider.model as string);
  const engineText = providers.length > 0 ? providers.join(', ') : configuredModels.length > 0 ? configuredModels.join(', ') : 'per-call provider recorded with each turn';

  const quorum = quorumPill(debate.status, quorumFromVotes(debate.votes, meta?.primary_agent ?? null));
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

  return { investigationId, detailError, meta, queued, onLeftQueue, failed, debate, bundle, domainName, citedTotal, subject, host, triggerTime, loadedAt, engineText, providers, consensusThreshold, settings, steps, citationList, fleet, roundFilter, setRoundFilter, totalRounds, agentName, running, wsState, doExport, quorum, supporters, confidenceCheck, canSign, signable, signBusy, doSign, citations };
}
