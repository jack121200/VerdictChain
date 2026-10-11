/** The four stages of adjudication, each with the live figures that back it. */
import { formatCount } from '../../lib/format';
import { AgentChip } from '../../ui/AgentChip';
import { Metric } from '../../ui/Metric';
import { FooterRow, PillarCard, percent } from './parts';
import type { useOverviewData } from './useOverviewData';

type Props = Pick<ReturnType<typeof useOverviewData>, 'rawCounts' | 'settings' | 'fleet' | 'stats' | 'status'>;

export function Pipeline({ rawCounts, settings, fleet, stats, status }: Props) {
  return (
    <>
      {/* 2. FOUR-STAGE PIPELINE */}
      <section className="relative mx-auto w-full max-w-7xl px-4 py-12 lg:px-6">
        <div className="mx-auto mb-10 max-w-3xl space-y-2 text-center">
          <span className="font-mono text-xs font-bold uppercase tracking-widest text-primary">Pipeline</span>
          <h2 className="font-headline text-3xl font-bold text-on-surface sm:text-4xl">Four stages of adjudication</h2>
          <p className="font-body text-sm text-on-surface-variant sm:text-base">
            From raw telemetry to a Watchdog-verified, hash-chained verdict with a sandboxed, fully audited response.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
          <PillarCard
            icon="receipt_long"
            phase="PHASE 01"
            accent="border-primary/20 bg-primary/10 text-primary"
            title="Multi-source ingestion"
            footer={
              (rawCounts.data?.sources ?? []).length === 0 ? (
                <FooterRow label="Rows">—</FooterRow>
              ) : (
                (rawCounts.data?.sources ?? []).map((row) => (
                  <FooterRow key={row.source} label={row.source}>
                    <Metric metric={row.count} size="body" label={`${row.source} rows`} />
                  </FooterRow>
                ))
              )
            }
          >
            Raw telemetry from the datasets is stored as rows in raw_logs in PostgreSQL. Counts are the real ingested totals per source.
          </PillarCard>

          <PillarCard
            icon="hub"
            phase="PHASE 02"
            accent="border-tertiary/20 bg-tertiary/10 text-tertiary"
            title="Three-round debate"
            footer={
              <>
                <FooterRow label="Rounds">{settings.data ? formatCount(settings.data.debate_rounds) : '—'}</FooterRow>
                <div className="flex flex-wrap gap-1.5">
                  {(fleet.data ?? []).map((agent) => (
                    <AgentChip key={agent.agent_id} agentId={agent.agent_id} name={agent.display_name} />
                  ))}
                </div>
              </>
            }
          >
            Three investigator agents cross-examine each other's hypotheses over a fixed number of rounds. Agent names come from the live fleet.
          </PillarCard>

          <PillarCard
            icon="verified_user"
            phase="PHASE 03"
            accent="border-secondary/20 bg-secondary/10 text-secondary"
            title="Watchdog verification"
            footer={
              <>
                <FooterRow label="Invalid citations">
                  <Metric metric={stats.data?.citations.invalid_row} size="body" label="Invalid citations" />
                </FooterRow>
                <FooterRow label="Discrepancies">
                  <Metric metric={stats.data?.watchdog.discrepancies} size="body" label="Discrepancies" />
                </FooterRow>
              </>
            }
          >
            Every cited log line is re-checked against raw_logs in PostgreSQL. Fabricated or mismatched citations lower the agent's credibility.
          </PillarCard>

          <PillarCard
            icon="warning"
            phase="PHASE 04"
            accent="border-primary/20 bg-primary/10 text-primary"
            title="Sandboxed response"
            footer={
              <>
                <FooterRow label="Simulated share">
                  <Metric metric={stats.data?.self_healing.simulated_share} size="body" format={percent} label="Simulated share" />
                </FooterRow>
                <FooterRow label="Sandbox violations">
                  <Metric metric={status.data?.sandbox.is_simulated_violations} size="body" label="Sandbox violations" />
                </FooterRow>
              </>
            }
          >
            Containment runs in a sandbox only and is fully audited; restore is audited too. Actions never reach a real system.
          </PillarCard>
        </div>
      </section>
    </>
  );
}
