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
import { formatTimestamp } from '../../lib/format';
import type { Tone } from '../../ui/classes';
import { Proof } from '../../ui/Proof';
import ScenarioModal from '../scenario';
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

/** Tone for an audit action in the event stream. */
function toneForAction(action: AuditEntry['action']): Tone | 'neutral' {
  if (action === 'verdict_reached' || action === 'emergency_containment') return 'error';
  if (action === 'agent_isolated' || action === 'agent_quarantined') return 'tertiary';
  if (action === 'round_completed' || action === 'investigation_started') return 'primary';
  if (action === 'credibility_update' || action === 'agent_restored') return 'secondary';
  return 'neutral';
}

function auditTime(iso: string): string {
  const stamped = formatTimestamp(iso);
  // formatTimestamp -> "YYYY-MM-DD HH:MM:SS UTC"; keep the clock + zone for the terminal.
  const parts = stamped.split(' ');
  return parts.length >= 3 ? `${parts[1]} ${parts[2]}` : stamped;
}

/** The live forensic console (plan 2.4): tactical banner, scenario control, pod triad, verdict ledger, audit stream, cited evidence. */
export default function DashboardPage() {
  const stats = useAsync(getStats, 30_000);
  const fleet = useAsync(getAgentFleet, 30_000);
  const scenarios = useAsync(listScenarios);
  const settings = useAsync(getSettings, 30_000);
  const me = useAsync(getMe);
  const audit = useAsync(() => listAuditTrail({ limit: AUDIT_LIMIT }), 30_000);
  const ledger = useAsync(() => listInvestigations({ limit: LEDGER_LIMIT }), 30_000);

  const items = ledger.data?.items ?? [];
  const latest: InvestigationSummary | undefined = items[0];
  const threat = useMemo(() => items.find((item) => isThreatClass(item.verdict_class)) ?? null, [items]);

  // Detail + citations of the latest investigation (drives the pod theories and cited evidence).
  const detail = useAsync(() => (latest ? getInvestigation(latest.id) : Promise.resolve(undefined)));
  const citations = useAsync(() => (latest ? getInvestigationCitations(latest.id) : Promise.resolve(undefined)));
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
    for (const entry of audit.data?.entries ?? []) {
      if (entry.action === 'verdict_reached' && entry.investigation_id && !map.has(entry.investigation_id)) {
        map.set(entry.investigation_id, entry.entry_hash);
      }
    }
    return map;
  }, [audit.data]);

  const terminalLines: TerminalLine[] = useMemo(() => {
    const entries = audit.data?.entries ?? [];
    return [...entries]
      .sort((a, b) => a.seq - b.seq)
      .map((entry) => ({
        key: String(entry.seq),
        time: auditTime(entry.created_at),
        body: `${entry.action.toUpperCase()} · actor ${entry.actor}${entry.investigation_id ? ` · inv ${entry.investigation_id.slice(0, 8)}` : ''}`,
        tone: toneForAction(entry.action),
      }));
  }, [audit.data]);

  const [cleared, setCleared] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

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
          onInject={() => setModalOpen(true)}
          onConfigure={() => setModalOpen(true)}
          blindProof={blindProof}
        />

        <PodTriad fleet={fleet.data} detail={detail.data} meanCrs={stats.data?.mean_crs} />

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

      <ScenarioModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        canInject={canInject}
        initialScenario={(selected as ScenarioLabel | null) ?? null}
      />
    </div>
  );
}
