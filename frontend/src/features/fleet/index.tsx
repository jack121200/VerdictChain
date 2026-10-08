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
import type { FaultInjectionResponse, FaultKind, FleetEntry, InvestigatorId, Metric as MetricEnvelope, StatsResponse, SystemStatus } from '../../api/types';
import { useAsync } from '../../app/use-async';
import { buildRoute } from '../../app/router';

import { AGENT_VISUALS, type AgentTone, type AgentVisualId } from '../../lib/agents';
import { cn } from '../../lib/cn';
import { formatCount, formatNumber, formatPercent } from '../../lib/format';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { Metric } from '../../ui/Metric';
import { Proof } from '../../ui/Proof';
import { Select } from '../../ui/Select';
import { Slider } from '../../ui/Slider';
import { TrajectoryChart } from '../../ui/TrajectoryChart';
import { pushToast } from '../../ui/toast-store';

type ServiceKey = 'watchdog' | 'self_healing';
type SelectionKey = InvestigatorId | ServiceKey;

const percent = (value: number): string => formatPercent(value, 1);

/** Square agent glyph avatar, tone from SKILL section 5 (reference avatarColor). */
const AVATAR_CLASS: Record<AgentTone, string> = {
  primary: 'border-primary text-primary bg-primary/10',
  secondary: 'border-secondary text-secondary bg-secondary/10',
  tertiary: 'border-tertiary text-tertiary bg-tertiary/10',
  'primary-container': 'border-primary-container text-secondary bg-on-primary-container',
  error: 'border-error/40 text-error bg-error-container/30',
};

function Avatar({ agentId, size = 'sm' }: { agentId: AgentVisualId; size?: 'sm' | 'lg' }) {
  const visual = AGENT_VISUALS[agentId];
  return (
    <div
      aria-hidden="true"
      className={cn(
        'flex items-center justify-center border font-headline font-bold',
        size === 'lg' ? 'h-12 w-12 rounded-xl text-2xl' : 'h-10 w-10 rounded-lg text-lg',
        AVATAR_CLASS[visual.tone],
      )}
    >
      {visual.glyph}
    </div>
  );
}

/** Colored live figure with a Proof popover: null renders an em dash plus reason, never 0. */
function Figure({
  metric,
  tone = 'text-on-surface',
  format,
  label,
  className,
}: {
  metric: MetricEnvelope<number> | undefined;
  tone?: string;
  format?: (value: number) => string;
  label: string;
  className: string;
}) {
  const value = metric?.value ?? null;
  const text = metric && value !== null ? (format ? format(value) : formatCount(value)) : '—';
  return (
    <span className="inline-flex flex-wrap items-baseline gap-1.5">
      <span className={cn(className, value === null ? 'text-on-surface-variant' : tone)}>{text}</span>
      {metric && value === null ? <span className="text-caption text-on-surface-variant">{metric.reason ?? 'no data reported'}</span> : null}
      {metric ? (
        <Proof source={metric.source} n={metric.n} asOf={metric.as_of} definition={metric.definition} reason={metric.reason} label={label} />
      ) : null}
    </span>
  );
}

function HudTile({ label, children, sub, subTone }: { label: string; children: ReactNode; sub: ReactNode; subTone?: string }) {
  return (
    <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low/80 p-4 backdrop-blur-md">
      <div className="font-mono text-[10px] uppercase text-on-surface-variant">{label}</div>
      <div className="mt-1">{children}</div>
      <div className={cn('mt-1 font-mono text-[10px]', subTone ?? 'text-on-surface-variant')}>{sub}</div>
    </div>
  );
}

function BoxLabel({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="flex items-center justify-between font-mono text-[10px] font-semibold uppercase text-outline">
      <span>{children}</span>
      {trailing}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 font-mono text-xs">
      <span className="text-on-surface-variant">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function AgentCard({ agent, selected, onSelect }: { agent: FleetEntry; selected: boolean; onSelect: () => void }) {
  const isolated = agent.isolated;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'relative flex flex-col justify-between rounded-xl border p-4 text-left transition-all',
        selected
          ? 'border-primary bg-surface-card shadow-glow-cyan ring-1 ring-primary/50'
          : 'border-outline-variant/40 bg-surface-container-low/70 hover:border-outline-variant hover:bg-surface-card/60',
        isolated ? 'opacity-60' : '',
      )}
    >
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <Avatar agentId={agent.agent_id} />
            <div>
              <div className="font-headline text-base font-bold text-on-surface">{agent.display_name}</div>
              <div className="font-mono text-[10px] text-primary">{agent.domain}</div>
            </div>
          </div>
          <span
            className={cn(
              'rounded border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider',
              isolated ? 'border-error/40 bg-error-container/40 text-error' : 'border-secondary/40 bg-secondary-container/20 text-secondary',
            )}
          >
            {isolated ? 'Quarantined' : 'Active'}
          </span>
        </div>
        <p className="mt-3 line-clamp-2 font-body text-xs text-on-surface-variant">{agent.signals.join(', ')}</p>
      </div>

      <div className="mt-4 space-y-2 border-t border-outline-variant/30 pt-3">
        <div className="flex items-center justify-between font-mono text-xs">
          <span className="text-outline">Credibility:</span>
          <Figure metric={agent.crs} tone="text-secondary" format={percent} label={`Credibility, ${agent.display_name}`} className="font-bold" />
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-background">
          <div
            className={cn('h-full rounded-full', agent.crs.value === null ? '' : 'bg-linear-to-r from-primary-container to-secondary')}
            style={{ width: `${(agent.crs.value ?? 0) * 100}%` }}
          />
        </div>
        <div className="flex items-center justify-between font-mono text-[10px] text-on-surface-variant">
          <span>
            Last vote: <strong className="text-on-surface">{agent.last_vote ?? 'none'}</strong>
          </span>
          <span>
            Citations: <strong className="text-on-surface">{agent.citations_verified.value ?? '—'}/{agent.citations_total.value ?? '—'}</strong>
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
      className={cn(
        'relative flex flex-col justify-between rounded-xl border p-4 text-left transition-all',
        selected
          ? 'border-primary bg-surface-card shadow-glow-cyan ring-1 ring-primary/50'
          : 'border-outline-variant/40 bg-surface-container-low/70 hover:border-outline-variant hover:bg-surface-card/60',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <Avatar agentId={agentId} />
          <div>
            <div className="flex items-center gap-1.5 font-headline text-base font-bold text-on-surface">
              {name}
              {agentId === 'watchdog' ? <Icon name="verified_user" size={16} className="text-secondary" /> : null}
            </div>
            <div className="font-mono text-[10px] text-primary">{domain}</div>
          </div>
        </div>
        <span className="rounded border border-primary-container/40 bg-on-primary-container px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-secondary">
          Service
        </span>
      </div>
      <div className="mt-4 space-y-2 border-t border-outline-variant/30 pt-3">{children}</div>
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

  const checkClass =
    result?.citation_check.status === 'VERIFIED' ? 'text-secondary' : result?.citation_check.status === 'DISCREPANCY' ? 'text-tertiary' : 'text-error';
  const points = result?.projected.trajectory.map((point) => ({ x: point.round, y: point.crs })) ?? [];

  return (
    <div className="space-y-3 rounded-xl border border-outline-variant/40 bg-background p-3.5">
      <BoxLabel
        trailing={
          <Proof
            source="POST /agents/{id}/fault-injection"
            n={result?.projected.trajectory.length ?? 0}
            asOf={null}
            definition="Runs the real citation check on a fabricated citation, projects the credibility trajectory with the live CrS formula, then re-reads production credibility to prove it is unchanged. Writes nothing."
            label="Fault-injection dry run"
          />
        }
      >
        Fault-injection dry run
      </BoxLabel>
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
      <Button variant="secondary" icon="warning" busy={running} onClick={run} className="w-full font-mono text-xs uppercase">
        Run dry run
      </Button>

      {error ? (
        <p className="flex items-center gap-1.5 font-body text-xs text-error">
          <Icon name="warning" size={12} label="Error" /> {error}
        </p>
      ) : null}

      {result ? (
        <div className="space-y-3">
          <Field label="Citation check">
            <span className={cn('font-mono text-xs font-bold uppercase', checkClass)}>
              {result.citation_check.status} · {result.citation_check.reason}
            </span>
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
          <div className="flex flex-col gap-2 rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] font-semibold uppercase text-outline">Production credibility</span>
              <span className={cn('font-mono text-xs font-bold uppercase', result.production_unchanged ? 'text-secondary' : 'text-error')}>
                {result.production_unchanged ? 'Unchanged' : 'Changed'}
              </span>
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
    <div className="space-y-2 rounded-xl border border-outline-variant/40 bg-background p-3.5">
      <BoxLabel
        trailing={
          <Proof
            source="POST /agents/{id}/quarantine · /restore"
            n={1}
            asOf={null}
            definition="Sets or clears the agent quarantine. Audited. A quarantined agent is excluded from later rounds and the verdict. Rejected during a debate in flight."
            label="Quarantine control"
          />
        }
      >
        {agent.isolated ? 'Restore agent' : 'Quarantine agent'}
      </BoxLabel>
      <input
        type="text"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder={agent.isolated ? 'Restore note (audited)' : 'Reason (audited)'}
        aria-label={agent.isolated ? 'Restore note' : 'Quarantine reason'}
        className="w-full rounded-lg border border-outline-variant/60 bg-surface-container-low px-3 py-2 font-mono text-xs text-on-surface placeholder:text-on-surface-variant focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      />
      <Button
        variant={agent.isolated ? 'secondary' : 'danger'}
        icon={agent.isolated ? 'check_circle' : 'warning'}
        busy={busy}
        onClick={act}
        className="w-full font-mono text-xs uppercase"
      >
        {agent.isolated ? 'Restore agent' : 'Quarantine agent'}
      </Button>
    </div>
  );
}

function InspectorShell({ children }: { children: ReactNode }) {
  return (
    <div className="sticky top-24 space-y-5 rounded-2xl border border-outline-variant/50 bg-surface-container-low p-5 shadow-2xl backdrop-blur-xl">
      {children}
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
    <InspectorShell>
      <div className="flex items-start justify-between gap-3 border-b border-outline-variant/40 pb-4">
        <div className="flex items-center gap-3">
          <Avatar agentId={agent.agent_id} size="lg" />
          <div className="min-w-0">
            <h2 className="font-headline text-xl font-bold text-on-surface">{agent.display_name}</h2>
            <span className="font-mono text-xs text-primary">{agent.domain}</span>
          </div>
        </div>
        <div className="text-right">
          <Figure metric={agent.crs} tone="text-secondary" format={percent} label={`Credibility, ${agent.display_name}`} className="font-headline text-2xl font-bold" />
          <div className="font-mono text-[9px] uppercase text-on-surface-variant">Credibility</div>
        </div>
      </div>

      <div className="space-y-2.5 rounded-xl border border-outline-variant/40 bg-background p-3.5 font-mono text-xs">
        <BoxLabel>Runtime configuration</BoxLabel>
        <Field label="LLM model:">
          <span className="font-semibold text-on-surface">{agent.model ?? 'not configured'}</span>
        </Field>
        <Field label="Temperature:">
          <Metric metric={agent.temperature} size="body" label="Temperature" className="text-primary" />
        </Field>
        <Field label="Provider chain:">
          <span className="text-on-surface">{agent.provider_chain.join(' → ') || '—'}</span>
        </Field>
        <Field label="Last vote class:">
          <span className="font-semibold text-tertiary">{agent.last_vote ?? 'no vote yet'}</span>
        </Field>
      </div>

      <div className="space-y-2 rounded-xl border border-outline-variant/40 bg-background p-3.5">
        <BoxLabel trailing={<span className="h-2 w-2 rounded-full bg-secondary animate-pulse" aria-hidden="true" />}>Signals (from the agent prompt)</BoxLabel>
        <div className="flex flex-wrap gap-1.5">
          {agent.signals.map((signal) => (
            <span key={signal} className="rounded border border-outline-variant/40 bg-surface-container-high px-1.5 py-0.5 font-mono text-[10px] text-on-surface-variant">
              {signal}
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-2.5 rounded-xl border border-outline-variant/40 bg-background p-3.5 font-mono text-xs">
        <BoxLabel>Watchdog scoring</BoxLabel>
        <Field label="Rounds scored:">
          <Metric metric={agent.rounds_scored} size="body" label="Rounds scored" />
        </Field>
        <Field label="Citations verified / total:">
          <span className="text-on-surface">
            {agent.citations_verified.value ?? '—'} / {agent.citations_total.value ?? '—'}
          </span>
        </Field>
        <Field label="Invalid-citation rate:">
          <Metric metric={agent.invalid_rate} size="body" format={percent} label="Invalid-citation rate" />
        </Field>
      </div>

      <div className="space-y-2 rounded-xl border border-outline-variant/40 bg-background p-3.5">
        <BoxLabel>Credibility trajectory</BoxLabel>
        <CredibilityHistoryChart agentId={agent.agent_id} isolationThreshold={isolationThreshold} />
      </div>

      {canInjectFault ? (
        <FaultInjectionPanel agentId={agent.agent_id} />
      ) : (
        <p className="rounded-xl border border-outline-variant/40 bg-background p-3.5 font-body text-xs text-on-surface-variant">
          Fault-injection dry run requires the override_fault_weights capability.
        </p>
      )}

      {canQuarantine ? <QuarantineControls agent={agent} onChanged={onChanged} /> : null}

      <a
        href={buildRoute({ name: 'investigations' })}
        className="flex items-center justify-center gap-1.5 rounded-lg bg-primary-container px-3 py-2.5 font-mono text-xs font-bold uppercase text-on-primary shadow-glow-cyan transition-all hover:bg-primary"
      >
        <Icon name="hub" size={16} /> Follow in debate
      </a>
    </InspectorShell>
  );
}

function WatchdogInspector({ stats }: { stats: StatsResponse | undefined }) {
  return (
    <InspectorShell>
      <div className="flex items-start justify-between gap-3 border-b border-outline-variant/40 pb-4">
        <div className="flex items-center gap-3">
          <Avatar agentId="watchdog" size="lg" />
          <div>
            <h2 className="font-headline text-xl font-bold text-on-surface">Watchdog</h2>
            <span className="font-mono text-xs text-primary">deterministic auditor (no LLM)</span>
          </div>
        </div>
        <Icon name="verified_user" size={20} className="text-secondary" />
      </div>
      <p className="font-body text-xs leading-relaxed text-on-surface-variant">
        Every cited row is re-checked against raw_logs in PostgreSQL; fabricated or mismatched citations lower an agent's credibility.
      </p>
      <div className="space-y-2.5 rounded-xl border border-outline-variant/40 bg-background p-3.5 font-mono text-xs">
        <BoxLabel trailing={<span className="h-2 w-2 rounded-full bg-secondary animate-pulse" aria-hidden="true" />}>Verification counters (24 h)</BoxLabel>
        <Field label="Checks run">
          <Metric metric={stats?.watchdog?.checks} size="body" label="Watchdog checks" />
        </Field>
        <Field label="Citations checked">
          <Metric metric={stats?.watchdog?.citations_checked} size="body" label="Citations checked" />
        </Field>
        <Field label="Discrepancies found">
          <Metric metric={stats?.watchdog?.discrepancies} size="body" label="Discrepancies" />
        </Field>
        <Field label="Isolations triggered">
          <Metric metric={stats?.watchdog?.isolations} size="body" label="Isolations" />
        </Field>
      </div>
      <div className="rounded-lg border border-primary-container/40 bg-on-primary-container/40 p-3 text-center font-mono text-xs text-primary">
        The Watchdog is an out-of-band auditor and cannot be quarantined.
      </div>
    </InspectorShell>
  );
}

function SelfHealingInspector({ stats, status }: { stats: StatsResponse | undefined; status: SystemStatus | undefined }) {
  return (
    <InspectorShell>
      <div className="flex items-start justify-between gap-3 border-b border-outline-variant/40 pb-4">
        <div className="flex items-center gap-3">
          <Avatar agentId="self_healing" size="lg" />
          <div>
            <h2 className="font-headline text-xl font-bold text-on-surface">Self-Healing</h2>
            <span className="font-mono text-xs text-primary">sandboxed containment</span>
          </div>
        </div>
        <Icon name="warning" size={20} className="text-error" />
      </div>
      <p className="font-body text-xs leading-relaxed text-on-surface-variant">
        Containment runs in a sandbox only. Each action carries an is_simulated flag; the sandbox module keeps no networking imports, so a real system is never reached.
      </p>
      <div className="space-y-2.5 rounded-xl border border-outline-variant/40 bg-background p-3.5 font-mono text-xs">
        <BoxLabel>Response counters (24 h)</BoxLabel>
        <Field label="Actions total">
          <Metric metric={stats?.self_healing?.actions_total} size="body" label="Actions total" />
        </Field>
        <Field label="Non-simulated">
          <Metric metric={stats?.self_healing?.non_simulated} size="body" label="Non-simulated actions" />
        </Field>
        <Field label="Simulated share">
          <Metric metric={stats?.self_healing?.simulated_share} size="body" format={percent} label="Simulated share" />
        </Field>
        <Field label="Sandbox violations">
          <Metric metric={status?.sandbox.is_simulated_violations} size="body" label="Sandbox violations" />
        </Field>
      </div>
      <div className="rounded-lg border border-outline-variant/40 bg-background p-3 text-center font-mono text-xs text-on-surface-variant">
        Self-Healing is a service and cannot be quarantined.
      </div>
    </InspectorShell>
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
    <section className="relative mx-auto min-h-screen w-full max-w-7xl px-4 py-6 lg:px-6">
      {/* Screen header */}
      <div className="flex flex-col justify-between gap-4 border-b border-outline-variant/40 pb-6 md:flex-row md:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-primary">
            <span className="h-2 w-2 rounded-full bg-secondary animate-pulse" aria-hidden="true" />
            <span>Investigator fleet • Watchdog-scored credibility</span>
          </div>
          <h1 className="font-headline text-3xl font-bold tracking-tight text-on-surface sm:text-4xl">
            Multi-agent <span className="text-primary">forensic fleet</span>
          </h1>
          <p className="mt-1 max-w-2xl font-body text-sm text-on-surface-variant">
            Three investigator agents analyze different log slices and debate; the Watchdog scores each one's cited evidence against raw logs, and Self-Healing contains confirmed threats in a sandbox.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <a
            href={buildRoute({ name: 'investigations' })}
            className="flex items-center gap-2 rounded bg-primary-container px-3 py-2 font-mono text-xs font-bold uppercase text-on-primary shadow-glow-cyan transition-all hover:bg-primary"
          >
            <Icon name="hub" size={16} /> Open investigations
          </a>
        </div>
      </div>

      {/* Global fleet telemetry KPIs */}
      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <HudTile
          label="Active agents"
          subTone="text-secondary"
          sub="Investigators + 2 services"
        >
          <span className="inline-flex items-baseline gap-2">
            <span className="font-headline text-2xl font-bold text-primary">{activeAgents === null ? '—' : activeAgents}</span>
            <span className="font-mono text-xs text-on-surface-variant">/ {totalAgents ?? '—'} Total</span>
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
          </span>
        </HudTile>
        <HudTile label="Mean fleet credibility" subTone="text-secondary" sub="Watchdog-scored (n = 3)">
          <Figure metric={stats.data?.mean_crs} tone="text-secondary" format={percent} label="Mean fleet credibility" className="font-headline text-2xl font-bold" />
        </HudTile>
        <HudTile label="Citation accuracy" sub="Verified / total citations">
          <Figure metric={stats.data?.citations.verified_rate} format={percent} label="Verified-citation rate" className="font-headline text-2xl font-bold" />
        </HudTile>
        <HudTile label="Consensus mode" subTone="text-primary" sub="Fixed dialectic rounds">
          <span className="inline-flex items-baseline gap-2">
            <span className="font-headline text-2xl font-bold text-tertiary">{settings.data ? `${formatCount(settings.data.debate_rounds)}-Round` : '—'}</span>
            <Proof source="GET /settings.debate_rounds" n={1} asOf={settings.loadedAt} definition="Number of debate rounds (read-only constant)." label="Debate rounds" />
          </span>
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
              <InspectorShell>
                <EmptyState title="No investigator selected" description="Select an agent card to inspect its configuration and credibility." icon="hub" />
              </InspectorShell>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
