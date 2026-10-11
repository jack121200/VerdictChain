/** The benchmark scenario suite of the Overview screen: every real scenario label with its dataset and row count. */
import { formatCountNoun } from '../../lib/format';
import { AgentChip } from '../../ui/AgentChip';
import { EmptyState } from '../../ui/EmptyState';
import { Metric } from '../../ui/Metric';
import { Proof } from '../../ui/Proof';
import type { useOverviewData } from './useOverviewData';

type Props = Pick<ReturnType<typeof useOverviewData>, 'scenarios'>;

export function ScenarioSuite({ scenarios }: Props) {
  return (
    <>
      {/* 3. BENCHMARK SCENARIO SUITE */}
      <section className="relative mx-auto w-full max-w-7xl px-4 py-10 lg:px-6">
        <div className="rounded-xl border border-outline-variant/50 bg-background p-5 shadow-2xl">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-mono text-[10px] uppercase text-on-surface-variant">Benchmark topology</span>
              <h3 className="font-headline text-lg font-semibold text-on-surface">Scenario suite</h3>
            </div>
            <span className="rounded border border-primary/30 bg-primary/20 px-2 py-0.5 font-mono text-[10px] font-bold text-primary">COUNTED IN raw_logs</span>
          </div>

          <div className="relative mt-4 w-full overflow-hidden rounded border border-outline-variant/40">
            <img src="/assets/topology-grid.jpg" alt="Abstract network topology grid artwork" className="h-56 w-full rounded object-cover opacity-80" />
            <div className="absolute inset-0 bg-linear-to-t from-background via-transparent to-transparent" />
            <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between font-mono text-[10px] text-on-surface">
              <span className="rounded border border-outline-variant/40 bg-surface/90 px-2 py-1 text-secondary backdrop-blur-sm">
                {scenarios.data ? formatCountNoun(scenarios.data.length, 'scenario label') : 'scenarios loading'}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded border border-outline-variant/40 bg-surface/90 px-2 py-1 text-primary backdrop-blur-sm">
                Agents never see the label (blind test)
                <Proof
                  source="backend/tests/agents/test_blind_boundary.py"
                  n={1}
                  asOf={null}
                  label="Blind-test proof"
                  definition="The ground-truth scenario label never reaches an investigator's input. This is checked by an AST scan, a seeded-secret test and a prompt test, not asserted in prose."
                />
              </span>
            </div>
          </div>

          <p className="mt-4 font-body text-sm text-on-surface-variant">
            The real scenario labels, their dataset and ingested row count. Investigator agents are never told which scenario was selected.
          </p>

          {scenarios.error && !scenarios.data ? (
            <div className="mt-4">
              <EmptyState title="Could not load scenarios" description={scenarios.error} icon="warning" />
            </div>
          ) : (scenarios.data ?? []).length === 0 ? (
            <div className="mt-4">
              <EmptyState title="No scenarios reported" icon="info" />
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {(scenarios.data ?? []).map((scenario) => (
                <div key={scenario.label} className="flex flex-col gap-2 rounded-xl border border-outline-variant/40 bg-surface-card p-4 transition-colors hover:border-primary/50">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-primary">{scenario.label}</span>
                    <span className="rounded-full border border-outline-variant/40 bg-surface-container-high px-2 py-0.5 font-mono text-[10px] uppercase text-on-surface-variant">{scenario.dataset}</span>
                  </div>
                  <p className="font-body text-xs text-on-surface-variant">{scenario.description}</p>
                  <div className="mt-auto flex items-center justify-between border-t border-outline-variant/40 pt-2">
                    {scenario.primary_agent ? (
                      <AgentChip agentId={scenario.primary_agent} name={scenario.primary_agent} />
                    ) : (
                      <span className="font-mono text-[10px] text-on-surface-variant">no rows ingested for this label</span>
                    )}
                    <Metric metric={scenario.row_count} size="body" label={`${scenario.label} rows`} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
