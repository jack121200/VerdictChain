/** The inspector panels of the Fleet screen: investigator, Watchdog and Self-Healing. */
import type { FleetEntry, StatsResponse, SystemStatus } from '../../api/types';
import { buildRoute } from '../../app/router';
import { formatMaybeCount } from '../../lib/format';
import { Icon } from '../../ui/Icon';
import { Metric } from '../../ui/Metric';
import { Avatar, BoxLabel, Field, Figure, InspectorShell, percent } from './shared';
import { CredibilityHistoryChart, FaultInjectionPanel, QuarantineControls } from './OperatorTools';

export function InvestigatorInspector({
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
            {formatMaybeCount(agent.citations_verified.value)} / {formatMaybeCount(agent.citations_total.value)}
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

export function WatchdogInspector({ stats }: { stats: StatsResponse | undefined }) {
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
        <BoxLabel trailing={<span className="h-2 w-2 rounded-full bg-secondary animate-pulse" aria-hidden="true" />}>Verification counters (all time)</BoxLabel>
        <Field label="Checks run">
          <Metric metric={stats?.watchdog?.checks_total} size="body" label="Watchdog checks" />
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

export function SelfHealingInspector({ stats, status }: { stats: StatsResponse | undefined; status: SystemStatus | undefined }) {
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
        <BoxLabel>Response counters (all time)</BoxLabel>
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
