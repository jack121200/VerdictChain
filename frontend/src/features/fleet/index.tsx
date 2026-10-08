import { useMemo, useState, type ReactNode } from 'react';
import {
  describeError,
  getAgentFleet,
  getCredibilityHistory,
  getMe,
  getSettings,
  getStats,
  getSystemStatus,
  injectFault,
  quarantineAgent,
  restoreAgent,
} from '../../api/client';
import type { FaultInjectionResponse, FaultKind, FleetEntry, InvestigatorId, StatsResponse, SystemStatus } from '../../api/types';
import { useAsync } from '../../app/use-async';
import { buildRoute } from '../../app/router';

import { formatCount, formatNumber, formatPercent } from '../../lib/format';
import { AgentChip } from '../../ui/AgentChip';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { Metric } from '../../ui/Metric';
import { Pill } from '../../ui/Pill';
import { ProgressBar } from '../../ui/ProgressBar';
import { Proof } from '../../ui/Proof';
import { Select } from '../../ui/Select';
import { Slider } from '../../ui/Slider';
import { StatusDot } from '../../ui/StatusDot';
import { TrajectoryChart } from '../../ui/TrajectoryChart';
import { pushToast } from '../../ui/toast-store';

type ServiceKey = 'watchdog' | 'self_healing';
type SelectionKey = InvestigatorId | ServiceKey;

const percent = (value: number): string => formatPercent(value, 1);

function HudTile({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <Card variant="panel" className="flex flex-col gap-1">
      <span className="text-label uppercase text-on-surface-variant">{label}</span>
      <div className="flex flex-wrap items-baseline gap-2">{children}</div>
      {sub ? <span className="text-caption text-on-surface-variant">{sub}</span> : null}
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-caption text-on-surface-variant">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function StatusPill({ isolated }: { isolated: boolean }) {
  return isolated ? (
    <Pill tone="error" icon="warning">
      Quarantined
    </Pill>
  ) : (
    <Pill tone="secondary" icon="check">
      Active
    </Pill>
  );
}

function AgentCard({ agent, selected, onSelect }: { agent: FleetEntry; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex flex-col justify-between rounded-xl border p-4 text-left transition-colors ${
        selected ? 'border-primary bg-surface-card shadow-glow-cyan' : 'border-outline-variant/40 bg-surface-card hover:border-primary/50'
      } ${agent.isolated ? 'opacity-70' : ''}`}
    >
      <div>
        <div className="flex items-start justify-between gap-2">
          <AgentChip agentId={agent.agent_id} name={agent.display_name} />
          <StatusPill isolated={agent.isolated} />
        </div>
        <p className="mt-1 font-mono text-evidence text-primary">{agent.domain}</p>
        <p className="mt-2 line-clamp-2 text-caption text-on-surface-variant">{agent.signals.join(' · ')}</p>
      </div>
      <div className="mt-4 space-y-2 border-t border-outline-variant/40 pt-3">
        <div className="flex items-center justify-between">
          <span className="text-label uppercase text-on-surface-variant">Credibility</span>
          <Metric metric={agent.crs} size="body" format={percent} label={`Credibility, ${agent.display_name}`} />
        </div>
        <ProgressBar value={agent.crs.value} label={`Credibility bar, ${agent.display_name}`} />
        <div className="flex items-center justify-between text-label uppercase text-on-surface-variant">
          <span>
            Citations{' '}
            <span className="font-mono normal-case text-on-surface">
              {agent.citations_verified.value ?? '—'}/{agent.citations_total.value ?? '—'}
            </span>
          </span>
          <span>
            Last vote <span className="font-mono normal-case text-on-surface">{agent.last_vote ?? 'none'}</span>
          </span>
        </div>
      </div>
    </button>
  );
}

function ServiceCard({
  agentId,
  name,
  domain,
  selected,
  onSelect,
  children,
}: {
  agentId: ServiceKey;
  name: string;
  domain: string;
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex flex-col justify-between rounded-xl border p-4 text-left transition-colors ${
        selected ? 'border-primary bg-surface-card shadow-glow-cyan' : 'border-outline-variant/40 bg-surface-card hover:border-primary/50'
      }`}
    >
      <div>
        <div className="flex items-start justify-between gap-2">
          <AgentChip agentId={agentId} name={name} />
          <Pill tone="primary" icon="verified_user">
            Service
          </Pill>
        </div>
        <p className="mt-1 font-mono text-evidence text-primary">{domain}</p>
      </div>
      <div className="mt-4 space-y-2 border-t border-outline-variant/40 pt-3">{children}</div>
    </button>
  );
}

function CredibilityHistoryChart({ agentId, isolationThreshold }: { agentId: InvestigatorId; isolationThreshold: number | undefined }) {
  const history = useAsync(() => getCredibilityHistory(agentId, { limit: 60 }));
  const rows = history.data ?? [];
  const points = rows.map((row, index) => ({ x: index + 1, y: row.crs_after }));
  if (history.error && !history.data) {
    return <EmptyState title="Could not load credibility history" description={history.error} icon="warning" />;
  }
  if (rows.length === 0) {
    return <EmptyState title="No scored rounds yet" description="Credibility points appear after this agent is scored in a debate round." icon="info" />;
  }
  return (
    <TrajectoryChart
      label={`Credibility history, ${agentId}`}
      series={[{ id: 'crs', label: 'Credibility after round', tone: 'primary', points }]}
      xDomain={[1, Math.max(1, points.length)]}
      yDomain={[0, 1]}
      threshold={isolationThreshold === undefined ? undefined : { value: isolationThreshold, label: 'Isolation' }}
      xLabel="Scored round (chronological)"
      yLabel="CrS"
      proof={{
        source: 'GET /agents/{id}/credibility-history crs_after',
        n: rows.length,
        asOf: history.loadedAt,
        definition: 'Credibility after each scored round, oldest to newest, from credibility_log. Threshold line is isolation_threshold from GET /settings.',
      }}
    />
  );
}

function FaultInjectionPanel({ agentId }: { agentId: InvestigatorId }) {
  const [kind, setKind] = useState<FaultKind>('ghost_row');
  const [rounds, setRounds] = useState(3);
  const [result, setResult] = useState<FaultInjectionResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(): Promise<void> {
    setRunning(true);
    setError(null);
    try {
      setResult(await injectFault(agentId, { kind, rounds }));
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setRunning(false);
    }
  }

  const checkTone = result?.citation_check.status === 'VERIFIED' ? 'secondary' : result?.citation_check.status === 'DISCREPANCY' ? 'tertiary' : 'error';
  const points = result?.projected.trajectory.map((point) => ({ x: point.round, y: point.crs })) ?? [];

  return (
    <div className="space-y-3 rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-label uppercase text-on-surface-variant">Fault-injection dry run</span>
        <Proof
          source="POST /agents/{id}/fault-injection"
          n={result?.projected.trajectory.length ?? 0}
          asOf={null}
          definition="Runs the real citation check on a fabricated citation, projects the credibility trajectory with the live CrS formula, then re-reads production credibility to prove it is unchanged. Writes nothing."
          label="Fault-injection dry run"
        />
      </div>
      <Select
        label="Fault kind"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'ghost_row', label: 'Ghost row (row not found)' },
          { value: 'value_mismatch', label: 'Value mismatch' },
          { value: 'malformed_row_id', label: 'Malformed row id' },
        ]}
      />
      <Slider label="Projected rounds" value={rounds} min={1} max={6} step={1} format={(value) => formatCount(value)} onChange={setRounds} />
      <Button variant="secondary" icon="warning" busy={running} onClick={run}>
        Run dry run
      </Button>

      {error ? (
        <p className="flex items-center gap-1.5 text-caption text-error">
          <Icon name="warning" size={12} label="Error" /> {error}
        </p>
      ) : null}

      {result ? (
        <div className="space-y-3">
          <Field label="Citation check">
            <Pill tone={checkTone}>
              {result.citation_check.status} · {result.citation_check.reason}
            </Pill>
          </Field>
          <TrajectoryChart
            label="Projected credibility trajectory"
            series={[{ id: 'projected', label: 'Projected CrS', tone: 'tertiary', points }]}
            xDomain={[1, Math.max(1, rounds)]}
            yDomain={[0, 1]}
            threshold={{ value: result.projected.isolation_threshold, label: 'Isolation' }}
            xLabel="Round"
            yLabel="CrS"
            proof={{
              source: 'POST /agents/{id}/fault-injection projected',
              n: points.length,
              asOf: null,
              definition: 'Projected CrS per round with compute_crs using the live eta and isolation threshold.',
              inputs: [
                { label: 'eta', value: formatNumber(result.projected.eta, 3) },
                { label: 'isolation_threshold', value: formatNumber(result.projected.isolation_threshold, 2) },
              ],
            }}
          />
          <div className="flex flex-col gap-2 rounded-lg border border-outline-variant/40 bg-background p-3">
            <div className="flex items-center justify-between">
              <span className="text-label uppercase text-on-surface-variant">Production credibility</span>
              {result.production_unchanged ? (
                <Pill tone="secondary" icon="verified_user">
                  Unchanged
                </Pill>
              ) : (
                <Pill tone="error" icon="warning">
                  Changed
                </Pill>
              )}
            </div>
            <Field label="Before">
              <Metric metric={result.production_crs.before} size="body" format={percent} label="Production CrS before" />
            </Field>
            <Field label="After">
              <Metric metric={result.production_crs.after} size="body" format={percent} label="Production CrS after" />
            </Field>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function QuarantineControls({ agent, onChanged }: { agent: FleetEntry; onChanged: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function act(): Promise<void> {
    setBusy(true);
    try {
      if (agent.isolated) {
        await restoreAgent(agent.agent_id, reason.trim() || 'Restored by analyst');
        pushToast(`${agent.display_name} restored to the active fleet.`, { tone: 'secondary' });
      } else {
        await quarantineAgent(agent.agent_id, reason.trim() || 'Quarantined by analyst');
        pushToast(`${agent.display_name} quarantined.`, { tone: 'tertiary' });
      }
      setReason('');
      onChanged();
    } catch (cause) {
      pushToast(describeError(cause), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-label uppercase text-on-surface-variant">{agent.isolated ? 'Restore agent' : 'Quarantine agent'}</span>
        <Proof
          source="POST /agents/{id}/quarantine · /restore"
          n={1}
          asOf={null}
          definition="Sets or clears the agent quarantine. Audited. A quarantined agent is excluded from later rounds and the verdict. Rejected during a debate in flight."
          label="Quarantine control"
        />
      </div>
      <input
        type="text"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder={agent.isolated ? 'Restore note (audited)' : 'Reason (audited)'}
        aria-label={agent.isolated ? 'Restore note' : 'Quarantine reason'}
        className="w-full rounded-lg border border-outline-variant/60 bg-surface-container-low px-3 py-2 text-body text-on-surface placeholder:text-on-surface-variant focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      />
      <Button variant={agent.isolated ? 'secondary' : 'danger'} icon={agent.isolated ? 'check' : 'warning'} busy={busy} onClick={act}>
        {agent.isolated ? 'Restore agent' : 'Quarantine agent'}
      </Button>
    </div>
  );
}

function InvestigatorInspector({
  agent,
  canQuarantine,
  canInjectFault,
  isolationThreshold,
  onChanged,
}: {
  agent: FleetEntry;
  canQuarantine: boolean;
  canInjectFault: boolean;
  isolationThreshold: number | undefined;
  onChanged: () => void;
}) {
  return (
    <Card className="sticky top-24 space-y-5" hairline>
      <div className="flex items-start justify-between gap-3 border-b border-outline-variant/40 pb-4">
        <div className="min-w-0">
          <AgentChip agentId={agent.agent_id} name={agent.display_name} />
          <p className="mt-1 font-mono text-evidence text-primary">{agent.domain}</p>
        </div>
        <div className="text-right">
          <Metric metric={agent.crs} format={percent} label={`Credibility, ${agent.display_name}`} />
          <p className="text-label uppercase text-on-surface-variant">Credibility</p>
        </div>
      </div>

      <div className="space-y-2.5 rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3.5">
        <span className="text-label uppercase text-on-surface-variant">Runtime configuration</span>
        <Field label="Model">
          <span className="font-mono text-evidence text-on-surface">{agent.model ?? 'not configured'}</span>
        </Field>
        <Field label="Temperature">
          <Metric metric={agent.temperature} size="body" label="Temperature" />
        </Field>
        <Field label="Provider chain">
          <span className="font-mono text-evidence text-on-surface">{agent.provider_chain.join(' → ') || '—'}</span>
        </Field>
      </div>

      <div className="space-y-1.5 rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3.5">
        <span className="text-label uppercase text-on-surface-variant">Signals (from the agent prompt)</span>
        <ul className="flex flex-wrap gap-1.5">
          {agent.signals.map((signal) => (
            <li key={signal}>
              <Pill tone="neutral">{signal}</Pill>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2.5 rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3.5">
        <span className="text-label uppercase text-on-surface-variant">Watchdog scoring</span>
        <Field label="Rounds scored">
          <Metric metric={agent.rounds_scored} size="body" label="Rounds scored" />
        </Field>
        <Field label="Citations verified / total">
          <span className="font-mono text-evidence text-on-surface">
            {agent.citations_verified.value ?? '—'} / {agent.citations_total.value ?? '—'}
          </span>
        </Field>
        <Field label="Invalid-citation rate">
          <Metric metric={agent.invalid_rate} size="body" format={percent} label="Invalid-citation rate" />
        </Field>
        <Field label="Last vote class">
          <span className="font-mono text-evidence text-on-surface">{agent.last_vote ?? 'no vote yet'}</span>
        </Field>
      </div>

      <div className="space-y-2">
        <span className="text-label uppercase text-on-surface-variant">Credibility history</span>
        <CredibilityHistoryChart agentId={agent.agent_id} isolationThreshold={isolationThreshold} />
      </div>

      {canInjectFault ? (
        <FaultInjectionPanel agentId={agent.agent_id} />
      ) : (
        <p className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3.5 text-caption text-on-surface-variant">
          Fault-injection dry run requires the override_fault_weights capability.
        </p>
      )}

      {canQuarantine ? <QuarantineControls agent={agent} onChanged={onChanged} /> : null}

      <a
        href={buildRoute({ name: 'investigations' })}
        className="inline-flex items-center gap-1.5 text-body text-primary underline-offset-2 hover:underline"
      >
        <Icon name="travel_explore" size={16} /> Open investigations
      </a>
    </Card>
  );
}

function WatchdogInspector({ stats }: { stats: StatsResponse | undefined }) {
  return (
    <Card className="sticky top-24 space-y-5" hairline>
      <div className="flex items-start justify-between gap-3 border-b border-outline-variant/40 pb-4">
        <AgentChip agentId="watchdog" name="Watchdog" />
        <Icon name="verified_user" size={20} className="text-primary" />
      </div>
      <p className="text-caption text-on-surface-variant">
        Deterministic auditor (no LLM). Every cited row is re-checked against raw_logs in PostgreSQL; fabricated or mismatched citations lower an agent's credibility.
      </p>
      <div className="space-y-2.5 rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3.5">
        <span className="text-label uppercase text-on-surface-variant">Verification counters (24 h)</span>
        <Field label="Checks run">
          <Metric metric={stats?.watchdog.checks} size="body" label="Watchdog checks" />
        </Field>
        <Field label="Citations checked">
          <Metric metric={stats?.watchdog.citations_checked} size="body" label="Citations checked" />
        </Field>
        <Field label="Discrepancies found">
          <Metric metric={stats?.watchdog.discrepancies} size="body" label="Discrepancies" />
        </Field>
        <Field label="Isolations triggered">
          <Metric metric={stats?.watchdog.isolations} size="body" label="Isolations" />
        </Field>
      </div>
      <p className="rounded-lg border border-outline-variant/40 bg-background p-3 text-caption text-on-surface-variant">
        The Watchdog is an out-of-band auditor and cannot be quarantined.
      </p>
    </Card>
  );
}

function SelfHealingInspector({ stats, status }: { stats: StatsResponse | undefined; status: SystemStatus | undefined }) {
  return (
    <Card className="sticky top-24 space-y-5" hairline>
      <div className="flex items-start justify-between gap-3 border-b border-outline-variant/40 pb-4">
        <AgentChip agentId="self_healing" name="Self-Healing" />
        <Icon name="warning" size={20} className="text-error" />
      </div>
      <p className="text-caption text-on-surface-variant">
        Containment runs in a sandbox only. Each action carries an is_simulated flag; the sandbox module keeps no networking imports, so a real system is never reached.
      </p>
      <div className="space-y-2.5 rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3.5">
        <span className="text-label uppercase text-on-surface-variant">Response counters (24 h)</span>
        <Field label="Actions total">
          <Metric metric={stats?.self_healing.actions_total} size="body" label="Actions total" />
        </Field>
        <Field label="Non-simulated">
          <Metric metric={stats?.self_healing.non_simulated} size="body" label="Non-simulated actions" />
        </Field>
        <Field label="Simulated share">
          <Metric metric={stats?.self_healing.simulated_share} size="body" format={percent} label="Simulated share" />
        </Field>
        <Field label="Sandbox violations">
          <Metric metric={status?.sandbox.is_simulated_violations} size="body" label="Sandbox violations" />
        </Field>
      </div>
      <p className="rounded-lg border border-outline-variant/40 bg-background p-3 text-caption text-on-surface-variant">
        Self-Healing is a service and cannot be quarantined.
      </p>
    </Card>
  );
}

export default function FleetPage() {
  const fleet = useAsync(getAgentFleet, 30_000);
  const stats = useAsync(getStats, 30_000);
  const settings = useAsync(getSettings, 30_000);
  const status = useAsync(getSystemStatus, 30_000);
  const me = useAsync(getMe);
  const [selectedKey, setSelectedKey] = useState<SelectionKey | null>(null);

  const investigators = useMemo(() => fleet.data ?? [], [fleet.data]);
  const effectiveKey: SelectionKey | null = selectedKey ?? investigators[0]?.agent_id ?? null;
  const selectedAgent = investigators.find((agent) => agent.agent_id === effectiveKey);

  const capabilities = me.data?.capabilities ?? [];
  const canQuarantine = capabilities.includes('quarantine_agent');
  const canInjectFault = capabilities.includes('override_fault_weights');
  const isolationThreshold = settings.data?.isolation_threshold;

  const activeInvestigators = investigators.filter((agent) => !agent.isolated).length;
  const totalAgents = investigators.length === 0 ? null : investigators.length + 2;
  const activeAgents = investigators.length === 0 ? null : activeInvestigators + 2;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-6">
      <header className="flex flex-col gap-4 border-b border-outline-variant/40 pb-6 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-2">
          <span className="inline-flex items-center gap-2 text-label uppercase text-primary">
            <StatusDot tone="live" /> Investigator fleet · Watchdog-scored credibility
          </span>
          <h1 className="font-headline text-h1 tracking-tight text-on-surface sm:text-h1-sm">
            Agent <span className="text-primary">fleet</span>
          </h1>
          <p className="max-w-2xl text-body text-on-surface-variant">
            Three investigator agents analyze different log slices and debate; the Watchdog scores each one's cited evidence against raw logs, and Self-Healing contains confirmed threats in a sandbox.
          </p>
        </div>
      </header>

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <HudTile label="Active agents" sub="Investigators + 2 services">
          <span className="font-headline text-kpi tabular-nums text-on-surface">
            {activeAgents === null ? '—' : `${activeAgents}/${totalAgents}`}
          </span>
          <Proof
            source="browser: GET /agents/fleet.isolated"
            n={investigators.length}
            asOf={fleet.loadedAt}
            definition="Investigators with isolated=false, plus the Watchdog and Self-Healing services, which are always active. Services are not investigators and are not scored."
            inputs={[
              { label: 'investigators', value: formatCount(investigators.length) },
              { label: 'not isolated', value: formatCount(activeInvestigators) },
            ]}
            label="Active agents"
          />
        </HudTile>
        <HudTile label="Mean fleet credibility" sub="Across the 3 investigators">
          <Metric metric={stats.data?.mean_crs} format={percent} label="Mean fleet credibility" />
        </HudTile>
        <HudTile label="Verified-citation rate" sub="Verified / total citations">
          <Metric metric={stats.data?.citations.verified_rate} format={percent} label="Verified-citation rate" />
        </HudTile>
        <HudTile label="Debate rounds" sub="Fixed dialectic rounds">
          <span className="font-headline text-kpi tabular-nums text-on-surface">{settings.data ? formatCount(settings.data.debate_rounds) : '—'}</span>
          <Proof source="GET /settings.debate_rounds" n={1} asOf={settings.loadedAt} definition="Number of debate rounds (read-only constant)." label="Debate rounds" />
        </HudTile>
      </div>

      {fleet.error && !fleet.data ? (
        <div className="mt-6">
          <EmptyState title="Could not load the fleet" description={fleet.error} icon="warning" />
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-7">
            {investigators.map((agent) => (
              <AgentCard key={agent.agent_id} agent={agent} selected={effectiveKey === agent.agent_id} onSelect={() => setSelectedKey(agent.agent_id)} />
            ))}
            <ServiceCard agentId="watchdog" name="Watchdog" domain="deterministic auditor" selected={effectiveKey === 'watchdog'} onSelect={() => setSelectedKey('watchdog')}>
              <Field label="Citations checked">
                <Metric metric={stats.data?.watchdog.citations_checked} size="body" label="Citations checked" />
              </Field>
              <Field label="Discrepancies">
                <Metric metric={stats.data?.watchdog.discrepancies} size="body" label="Discrepancies" />
              </Field>
            </ServiceCard>
            <ServiceCard
              agentId="self_healing"
              name="Self-Healing"
              domain="sandboxed containment"
              selected={effectiveKey === 'self_healing'}
              onSelect={() => setSelectedKey('self_healing')}
            >
              <Field label="Actions total">
                <Metric metric={stats.data?.self_healing.actions_total} size="body" label="Actions total" />
              </Field>
              <Field label="Simulated share">
                <Metric metric={stats.data?.self_healing.simulated_share} size="body" format={percent} label="Simulated share" />
              </Field>
            </ServiceCard>
          </div>

          <div className="lg:col-span-5">
            {effectiveKey === 'watchdog' ? (
              <WatchdogInspector stats={stats.data} />
            ) : effectiveKey === 'self_healing' ? (
              <SelfHealingInspector stats={stats.data} status={status.data} />
            ) : selectedAgent ? (
              <InvestigatorInspector
                key={selectedAgent.agent_id}
                agent={selectedAgent}
                canQuarantine={canQuarantine}
                canInjectFault={canInjectFault}
                isolationThreshold={isolationThreshold}
                onChanged={fleet.reload}
              />
            ) : (
              <Card className="sticky top-24">
                <EmptyState title="No investigator selected" description="Select an agent card to inspect its configuration and credibility." icon="hub" />
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
