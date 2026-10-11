import { useMemo, useState } from 'react';
import { getAgentFleet, getMe, getSettings, getStats, getSystemStatus } from '../../api/client';
import { useAsync } from '../../app/use-async';
import { buildRoute } from '../../app/router';
import { formatCount, formatMaybeCount } from '../../lib/format';
import { EmptyState } from '../../ui/EmptyState';
import { HintStrip } from '../../ui/HintStrip';
import { Icon } from '../../ui/Icon';
import { Metric } from '../../ui/Metric';
import { Proof } from '../../ui/Proof';
import { Field, Figure, HudTile, InspectorShell, SelectionKey, percent } from './shared';
import { AgentCard, ServiceCard } from './Cards';
import { InvestigatorInspector, SelfHealingInspector, WatchdogInspector } from './Inspectors';

const HINT = [
  'Select an agent card to inspect it on the right: its model and provider chain, the signals from its prompt, its credibility history and, for roles that hold the capability, the quarantine and fault-injection controls.',
  'Credibility, citation counts and rates come from the Watchdog’s checks (GET /agents/fleet and GET /stats), not from what an agent says about itself.',
  'The Watchdog and Self-Healing are services, not investigators, so they show counters instead of a credibility score.',
] as const;

export default function FleetPage() {
  const fleet = useAsync(getAgentFleet, 30_000, ['agents', 'credibility']);
  const stats = useAsync(getStats, 30_000, ['stats', 'investigations', 'actions']);
  const settings = useAsync(getSettings, 30_000, ['settings']);
  const status = useAsync(getSystemStatus, 30_000, ['investigations', 'agents', 'settings', 'actions']);
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
            Three investigator agents analyze different log slices and debate; the Watchdog scores each one's cited evidence against raw logs, and Self-Healing contains a confident verdict backed by credible agents, in a sandbox.
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

      <HintStrip pageId="fleet" sentences={HINT} className="mt-4" />

      {/* Global fleet telemetry KPIs */}
      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <HudTile
          label="Active agents"
          subTone="text-secondary"
          sub="Investigators + 2 services"
        >
          <span className="inline-flex items-baseline gap-2">
            <span className="font-headline text-2xl font-bold text-primary">{formatMaybeCount(activeAgents)}</span>
            <span className="font-mono text-xs text-on-surface-variant">/ {formatMaybeCount(totalAgents)} Total</span>
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
        <HudTile
          label="Mean fleet credibility"
          subTone="text-secondary"
          sub={`Watchdog-scored (n = ${stats.data ? formatCount(stats.data.mean_crs.n) : '—'})`}
        >
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
          <div className="grid grid-cols-1 content-start gap-4 sm:grid-cols-2 lg:col-span-7">
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
