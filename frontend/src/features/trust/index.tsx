import { useMemo } from 'react';
import { getAgentFleet, getCredibilityHistory, getMe, getSettings, getStats, getSystemStatus } from '../../api/client';
import type { InvestigatorId } from '../../api/types';
import { PageState } from '../../app/PageState';
import { useAsync } from '../../app/use-async';
import { usePageData } from '../../app/use-page-data';
import { INVESTIGATOR_IDS, INVESTIGATOR_VISUALS } from '../../lib/agents';
import { formatPercent, formatSignedPercent } from '../../lib/format';
import { AdaptiveThreshold } from './AdaptiveThreshold';
import { EvaluationPanel } from './Evaluation';
import { HintStrip } from '../../ui/HintStrip';
import { Icon } from '../../ui/Icon';
import { Proof } from '../../ui/Proof';
import { Skeleton } from '../../ui/Skeleton';
import { Timestamp } from '../../ui/Timestamp';
import { TrajectoryChart, type TrajectorySeries } from '../../ui/TrajectoryChart';
import { agentDelta, flaggedAgents, isolationGauge, latestChange, overallDelta, type HistoryMap } from './derive';
import { TrustHeader } from './TrustHeader';
import { AgentScorecard } from './AgentScorecard';
import { IsolationProtocol, MechanismCard } from './Mechanism';
import { CitationLedger } from './CitationLedger';
import { PolicyConfigurator } from './PolicyConfigurator';

const HINT = [
  'Each investigator’s credibility score (CrS) is moved only by the Watchdog’s re-check of its cited rows against raw_logs, not by what the other agents say.',
  'Scores come from GET /agents/fleet and the trajectory from each agent’s credibility_log; the dashed line is the isolation threshold from GET /settings, and an agent that falls below it after a round is quarantined.',
  'The ledger lists the citations the Watchdog re-checked, with the cited value next to the value the row really holds; only roles that hold edit_settings can change the live thresholds below.',
] as const;

/** Trust & Credibility: Watchdog scoring, trajectory, citation ledger and the real settings configurator (plan 2.7). */
export default function TrustPage() {
  const fleet = usePageData(getAgentFleet, 30_000, ['agents', 'credibility']);
  const settings = useAsync(getSettings, 30_000, ['settings']);
  const status = useAsync(getSystemStatus, 30_000, ['investigations', 'agents', 'settings', 'actions']);
  const stats = useAsync(getStats, 30_000, ['stats', 'investigations', 'actions']);
  const me = useAsync(getMe);
  const histories = useAsync(
    () => Promise.all(INVESTIGATOR_IDS.map((agentId) => getCredibilityHistory(agentId, { limit: 60 }))),
    30_000,
    ['credibility', 'agents'],
  );

  const historyMap = useMemo<HistoryMap>(
    () =>
      Object.fromEntries(
        INVESTIGATOR_IDS.map((agentId, index) => [agentId, histories.data?.[index] ?? []]),
      ) as HistoryMap,
    [histories.data],
  );

  const fleetList = fleet.data ?? [];
  const nameOf = (agentId: InvestigatorId): string =>
    fleetList.find((entry) => entry.agent_id === agentId)?.display_name ?? agentId;

  const flagged = useMemo(() => new Set(flaggedAgents(historyMap)), [historyMap]);
  const overall = useMemo(() => overallDelta(historyMap), [historyMap]);
  const change = useMemo(() => latestChange(historyMap), [historyMap]);
  const isolated = fleetList.filter((entry) => entry.isolated).length;
  const scoredRounds = INVESTIGATOR_IDS.reduce((total, agentId) => total + historyMap[agentId].length, 0);

  const gauge = useMemo(
    () => (settings.data ? isolationGauge(fleetList, settings.data.isolation_threshold) : null),
    [fleetList, settings.data],
  );

  const series: TrajectorySeries[] = INVESTIGATOR_IDS.map((agentId) => ({
    id: agentId,
    label: nameOf(agentId),
    tone: INVESTIGATOR_VISUALS[agentId].tone,
    points: historyMap[agentId].map((row, index) => ({ x: index + 1, y: row.crs_after })),
  }));
  const maxLen = Math.max(1, ...INVESTIGATOR_IDS.map((agentId) => historyMap[agentId].length));

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 text-on-surface lg:px-6">
      <HintStrip pageId="trust" sentences={HINT} />

      <TrustHeader
        meanCrs={stats.data?.mean_crs}
        overall={overall}
        overallAsOf={histories.loadedAt}
        isolated={isolated}
        fleetCount={fleetList.length}
        fleetLoaded={fleet.data !== undefined}
        flaggedCount={flagged.size}
        scoredRounds={scoredRounds}
      />

      {/* 2. Agent credibility scorecards + trajectory */}
      <section className="grid grid-cols-1 items-start gap-5 xl:grid-cols-12">
        <div className="space-y-3.5 xl:col-span-7">
          <div className="flex items-center justify-between pb-1">
            <div className="flex items-center gap-2">
              <Icon name="hub" size={20} className="text-primary" />
              <h2 className="font-headline text-lg font-bold text-on-surface">Agent credibility vectors</h2>
            </div>
            <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase text-on-surface-variant">
              Sample window: {scoredRounds} scored rounds
              <Proof
                source="GET /agents/{id}/credibility-history"
                n={scoredRounds}
                asOf={histories.loadedAt}
                definition="Total credibility_log rows loaded across the three investigators (up to 60 most recent each)."
                label="Sample window"
              />
            </span>
          </div>

          <PageState
            page={fleet}
            className="font-mono text-xs text-error"
            skeleton={
              <div className="space-y-3.5">
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
              </div>
            }
          />
          {fleetList.map((agent) => (
            <AgentScorecard
              key={agent.agent_id}
              agent={agent}
              delta={agentDelta(historyMap[agent.agent_id])}
              flagged={flagged.has(agent.agent_id)}
              asOf={fleet.loadedAt}
            />
          ))}
        </div>

        {/* Trajectory */}
        <div className="space-y-4 rounded-xl border border-outline-variant/40 bg-surface-container-low p-4 shadow-md xl:col-span-5">
          <div className="space-y-0.5">
            <h3 className="font-headline text-base font-bold text-on-surface">Credibility trajectory</h3>
            <span className="font-mono text-[10px] uppercase text-on-surface-variant">
              CrS after each scored round · credibility_log
            </span>
          </div>
          <div className="rounded-lg border border-outline-variant/30 bg-background p-3 shadow-inner">
            <TrajectoryChart
              label="Credibility trajectory for the three investigators"
              series={series}
              xDomain={[1, maxLen]}
              yDomain={[0, 1]}
              threshold={
                settings.data ? { value: settings.data.isolation_threshold, label: 'Isolation threshold' } : undefined
              }
              xLabel="Scored round (chronological)"
              yLabel="CrS"
              proof={{
                source: 'GET /agents/{id}/credibility-history crs_after · GET /settings.isolation_threshold',
                n: scoredRounds,
                asOf: histories.loadedAt,
                definition:
                  'Credibility after each scored round, oldest to newest, from credibility_log. The dashed line is the live isolation threshold.',
              }}
            />
          </div>
          <div className="space-y-1 rounded-lg border border-outline-variant/30 bg-surface-card p-3">
            <div className="flex items-center justify-between text-on-surface">
              <span className="flex items-center gap-1.5 font-mono text-xs font-semibold uppercase text-primary">
                <Icon name="sync_alt" size={16} />
                Latest credibility adjustment
              </span>
              <span className="font-mono text-[10px] font-bold uppercase text-secondary">
                {change ? 'from log' : 'no data'}
              </span>
            </div>
            <p className="font-body text-xs leading-relaxed text-on-surface-variant">
              {change ? (
                <>
                  {nameOf(change.agent)} moved{' '}
                  <span className={change.delta >= 0 ? 'text-secondary' : 'text-error'}>{formatSignedPercent(change.delta)}</span> after
                  round {change.round}; Watchdog match rate {formatPercent(change.matchRate)} (<Timestamp iso={change.at} />).
                </>
              ) : (
                'No scored rounds yet. Credibility adjustments appear here after an investigator is scored in a debate.'
              )}
            </p>
          </div>
        </div>
      </section>

      {/* 3. Mechanism + isolation protocol */}
      <section className="grid grid-cols-1 items-stretch gap-5 lg:grid-cols-12">
        <MechanismCard />
        <IsolationProtocol gauge={gauge} nameOf={nameOf} asOf={settings.loadedAt} settingsLoaded={settings.data !== undefined} />
      </section>

      {/* 4. Citation validation ledger */}
      <CitationLedger nameOf={nameOf} />

      {/* 5. Policy configurator */}
      <PolicyConfigurator
        settings={settings.data}
        settingsUpdatedBy={settings.data?.updated_by ?? null}
        settingsUpdatedAt={settings.data?.updated_at ?? null}
        canEdit={me.data?.capabilities.includes('edit_settings') ?? false}
        sandboxViolations={status.data?.sandbox.is_simulated_violations}
        onApplied={settings.reload}
      />

      {/* 6. Adaptive verdict floor */}
      <AdaptiveThreshold />

      {/* 7. Accuracy against labelled scenarios */}
      <EvaluationPanel />
    </div>
  );
}
