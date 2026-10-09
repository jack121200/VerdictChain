import { useEffect, useMemo, useState } from 'react';
import {
  getAgentFleet,
  getInvestigation,
  getInvestigationCitations,
  getMe,
  getSettings,
  getStats,
  listAuditTrail,
  listInvestigations,
  listScenarios,
} from '../../api/client';
import type {
  AuditEntry,
  InvestigationSummary,
  ScenarioLabel,
} from '../../api/types';
import { useAsync } from '../../app/use-async';
import { useScenarioModal } from '../../shell/scenario-modal';
import type { Tone } from '../../ui/classes';
import { HintStrip } from '../../ui/HintStrip';
import { Proof } from '../../ui/Proof';
import {
  EvidenceTraces,
  PodTriad,
  ScenarioBar,
  TacticalBanner,
  TerminalStream,
  VerdictLedger,
  type TerminalLine,
} from './components';
import { isThreatClass, mostCitedValue } from './derive';

const LEDGER_LIMIT = 8;
const AUDIT_LIMIT = 60;
/** The ledger's audit hashes come from their own query, so a row older than the event stream still gets its hash. */
const VERDICT_HASH_LIMIT = 50;

/** Tone for an audit action in the event stream. */
function toneForAction(action: AuditEntry['action']): Tone | 'neutral' {
  if (action === 'verdict_reached' || action === 'emergency_containment') return 'error';
  if (action === 'agent_isolated' || action === 'agent_quarantined') return 'tertiary';
  if (action === 'round_completed' || action === 'investigation_started') return 'primary';
  if (action === 'credibility_update' || action === 'agent_restored') return 'secondary';
  return 'neutral';
}

const HINT = [
  'From the top: the latest investigation with a threat verdict, live counters, the three investigators with their credibility, the most recent verdicts with their audit hashes, the audit event stream and the rows the Watchdog checked.',
  'Counters come from GET /stats, agents from GET /agents/fleet, cases from GET /investigations and events from GET /audit-trail; the page refreshes itself (server push, with polling as the fallback).',
  'Confidence is agent-reported, not accuracy, and the info button beside any number shows its source, sample size and formula.',
] as const;

/** The live forensic console (plan 2.4): tactical banner, scenario control, pod triad, verdict ledger, audit stream, cited evidence. */
export default function DashboardPage() {
  const scenario = useScenarioModal();
  const stats = useAsync(getStats, 30_000, ['stats', 'investigations', 'actions']);
  const fleet = useAsync(getAgentFleet, 30_000, ['agents', 'credibility']);
  const scenarios = useAsync(listScenarios);
  const settings = useAsync(getSettings, 30_000, ['settings']);
  const me = useAsync(getMe);
  const audit = useAsync(() => listAuditTrail({ limit: AUDIT_LIMIT }), 30_000, ['audit']);
  const verdictEntries = useAsync(() => listAuditTrail({ action: 'verdict_reached', limit: VERDICT_HASH_LIMIT }), 30_000, ['audit']);
  const ledger = useAsync(() => listInvestigations({ limit: LEDGER_LIMIT }), 30_000, ['investigations']);

  const items = ledger.data?.items ?? [];
  const latest: InvestigationSummary | undefined = items[0];
  const threat = useMemo(() => items.find((item) => isThreatClass(item.verdict_class)) ?? null, [items]);

  // Detail + citations of the latest investigation (drives the pod theories and cited evidence).
  const detail = useAsync(() => (latest ? getInvestigation(latest.id) : Promise.resolve(undefined)), undefined, ['investigations', 'credibility'], [latest?.id]);
  const citations = useAsync(() => (latest ? getInvestigationCitations(latest.id) : Promise.resolve(undefined)), undefined, ['investigations', 'credibility'], [latest?.id]);
  const { reload: reloadDetail } = detail;
  const { reload: reloadCitations } = citations;
  useEffect(() => {
    if (latest) {
      reloadDetail();
      reloadCitations();
    }
  }, [latest, reloadDetail, reloadCitations]);

  // Threat subject/host come from the threat investigation's own citations, when it is the latest.
  const threatCitations =
    threat && latest && threat.id === latest.id ? citations.data?.citations ?? [] : [];
  const subject = threatCitations.length > 0 ? mostCitedValue(threatCitations, 'user_id') : null;
  const host = threatCitations.length > 0 ? mostCitedValue(threatCitations, 'host_id') : null;
  const primaryAgentName = threat?.primary_agent
    ? fleet.data?.find((entry) => entry.agent_id === threat.primary_agent)?.display_name ?? null
    : null;

  const verdictHashes = useMemo(() => {
    const map = new Map<string, string>();
    // Entries come newest first, so the first verdict_reached seen for a case is its latest.
    for (const entry of verdictEntries.data?.entries ?? []) {
      if (entry.action === 'verdict_reached' && entry.investigation_id && !map.has(entry.investigation_id)) {
        map.set(entry.investigation_id, entry.entry_hash);
      }
    }
    return map;
  }, [verdictEntries.data]);

  const terminalLines: TerminalLine[] = useMemo(() => {
    const entries = audit.data?.entries ?? [];
    return [...entries]
      .sort((a, b) => a.seq - b.seq)
      .map((entry) => ({
        key: String(entry.seq),
        at: entry.created_at,
        action: entry.action,
        actor: entry.actor,
        investigationId: entry.investigation_id,
        tone: toneForAction(entry.action),
      }));
  }, [audit.data]);

  const [cleared, setCleared] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (scenarios.data && scenarios.data.length > 0) {
      setSelected((current) => current ?? scenarios.data![0].label);
    }
  }, [scenarios.data]);

  const canInject = me.data?.capabilities.includes('inject_scenario') ?? false;

  const blindProof = (
    <Proof
      source="backend/tests/agents/test_blind_boundary.py"
      n={1}
      asOf={null}
      label="Blind-test proof"
      definition="The ground-truth scenario label never reaches an investigator's input. This is checked by an AST scan, a seeded-secret test and a prompt test (plan R9), not asserted in prose."
    />
  );

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-6">
      <div className="flex w-full flex-col gap-5">
        <h1 className="sr-only">Forensics dashboard</h1>
        <HintStrip pageId="dashboard" sentences={HINT} />

        <TacticalBanner
          threat={threat}
          loading={ledger.data === undefined}
          subject={subject}
          host={host}
          primaryAgentName={primaryAgentName}
          chain={audit.data?.chain}
          chainLoadedAt={audit.loadedAt}
          stats={stats.data}
        />

        <ScenarioBar
          scenarios={scenarios.data}
          selected={selected}
          onSelect={setSelected}
          canInject={canInject}
          onInject={() => scenario?.open((selected as ScenarioLabel | null) ?? null)}
          onConfigure={() => scenario?.open((selected as ScenarioLabel | null) ?? null)}
          blindProof={blindProof}
        />

        <PodTriad fleet={fleet.data} detail={detail.data} meanCrs={stats.data?.mean_crs} debateRounds={settings.data?.debate_rounds} />

        <section className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <VerdictLedger
            rows={items}
            loading={ledger.data === undefined}
            hashFor={(id) => verdictHashes.get(id) ?? null}
            debateRounds={settings.data?.debate_rounds}
            headSeq={audit.data?.chain.head_seq ?? null}
            chainLoadedAt={audit.loadedAt}
          />
          <TerminalStream lines={cleared ? [] : terminalLines} onClear={() => setCleared(true)} loadedAt={audit.loadedAt} />
        </section>

        <EvidenceTraces citations={citations.data?.citations} loading={citations.data === undefined && citations.error === null} />
      </div>
    </div>
  );
}
