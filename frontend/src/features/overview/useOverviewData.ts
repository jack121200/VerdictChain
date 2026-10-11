/** Everything the Overview screen loads from the API, and the few figures it derives in the browser. */
import { useMemo } from 'react';
import { getAgentFleet, getEvaluation, getRawLogCounts, getSettings, getStats, getSystemStatus, listAuditTrail, listInvestigations, listRecentRawLogs, listScenarios } from '../../api/client';
import { useAsync } from '../../app/use-async';
import { deriveMeanLatencyMs } from './derive';

export function useOverviewData() {
  const evaluation = useAsync(getEvaluation, undefined, ['investigations']);
  // Accuracy counts model runs only; the offline stub's scored runs are reported next to it, never inside it.
  const stubScored = evaluation.data?.by_source?.stub.scored.value ?? 0;
  const stats = useAsync(getStats, 30_000, ['stats', 'investigations', 'actions']);
  const fleet = useAsync(getAgentFleet, 30_000, ['agents', 'credibility']);
  const scenarios = useAsync(listScenarios);
  const rawCounts = useAsync(getRawLogCounts, 30_000);
  const settings = useAsync(getSettings, 30_000, ['settings']);
  const status = useAsync(getSystemStatus, 30_000, ['investigations', 'agents', 'settings', 'actions']);
  const audit = useAsync(() => listAuditTrail({ limit: 200 }), 30_000, ['audit']);
  const recent = useAsync(() => listRecentRawLogs({ limit: 4 }), 30_000);
  const latest = useAsync(() => listInvestigations({ limit: 1 }), 30_000, ['investigations']);

  const latency = useMemo(() => deriveMeanLatencyMs(audit.data?.entries ?? []), [audit.data]);
  const providers = status.data?.providers;
  const latestItem = latest.data?.items?.[0];
  const latestConfidence = latestItem?.verdict_confidence ?? null;
  const recentRows = recent.data ?? [];

  return { stubScored, evaluation, latency, audit, stats, status, recentRows, recent, latestConfidence, latest, latestItem, settings, rawCounts, fleet, scenarios, providers };
}
