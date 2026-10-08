import { useEffect, useMemo, useState } from 'react';
import { describeError, listScenarios, simulateInvestigation } from '../../api/client';
import type { DatasetName, NoisePct, ScenarioLabel, ScenarioSummary } from '../../api/types';
import { buildRoute } from '../../app/router';
import { useAsync } from '../../app/use-async';
import { shortId } from '../../lib/format';
import { cn } from '../../lib/cn';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { Metric } from '../../ui/Metric';
import { Modal } from '../../ui/Modal';
import { Proof } from '../../ui/Proof';
import { Skeleton } from '../../ui/Skeleton';
import { Slider } from '../../ui/Slider';
import { pushToast } from '../../ui/toast-store';

export interface ScenarioModalProps {
  open: boolean;
  onClose: () => void;
  /** Whether /auth/me grants inject_scenario. When false, Authorize is disabled with a note. */
  canInject: boolean;
  /** Pre-select this scenario when the modal opens (from the dashboard matrix). */
  initialScenario?: ScenarioLabel | null;
}

const NOISE_OPTIONS: readonly NoisePct[] = [0, 15, 30];

/** Dataset groups, in CICIDS-then-CERT order, as in plan 2.11. */
const GROUP_ORDER: ReadonlyArray<{ dataset: DatasetName; title: string }> = [
  { dataset: 'CICIDS2017', title: 'CICIDS2017 · network traffic' },
  { dataset: 'CERT_r4.2', title: 'CERT r4.2 · insider' },
];

const DEFAULT_MAX_ROWS = 5;

/**
 * Scenario injection modal (plan 2.11). Scenarios come from GET /scenarios, grouped by dataset.
 * Authorize calls POST /investigations/simulate with wait=false, then navigates to the debate by
 * the real investigation id. Target-swarm and custom-JSON are dropped; the blind test is a real note.
 */
export default function ScenarioModal({ open, onClose, canInject, initialScenario = null }: ScenarioModalProps) {
  const scenariosQ = useAsync(listScenarios);
  const [selected, setSelected] = useState<ScenarioLabel | null>(initialScenario);
  const [noise, setNoise] = useState<NoisePct>(0);
  const [maxRows, setMaxRows] = useState(DEFAULT_MAX_ROWS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scenarios = scenariosQ.data;

  // Pick a default once the list loads: the requested scenario if present, else the first one.
  useEffect(() => {
    if (!scenarios || scenarios.length === 0) return;
    setSelected((current) => {
      if (current && scenarios.some((s) => s.label === current)) return current;
      const wanted = initialScenario && scenarios.find((s) => s.label === initialScenario);
      return (wanted ?? scenarios[0]).label;
    });
  }, [scenarios, initialScenario]);

  const groups = useMemo(() => {
    const byDataset = new Map<DatasetName, ScenarioSummary[]>();
    for (const scenario of scenarios ?? []) {
      const list = byDataset.get(scenario.dataset) ?? [];
      list.push(scenario);
      byDataset.set(scenario.dataset, list);
    }
    return GROUP_ORDER.map((group) => ({ ...group, items: byDataset.get(group.dataset) ?? [] })).filter(
      (group) => group.items.length > 0,
    );
  }, [scenarios]);

  async function authorize() {
    if (selected === null) return;
    setBusy(true);
    setError(null);
    try {
      const accepted = await simulateInvestigation({
        scenario_label: selected,
        max_rows_per_agent: maxRows,
        noise_pct: noise,
        wait: false,
      });
      pushToast(
        `Investigation ${shortId(accepted.investigation_id)} started · primary ${accepted.primary_agent} · effective noise ${accepted.effective_noise_pct}%`,
        { tone: 'secondary', durationMs: 6000 },
      );
      onClose();
      window.location.hash = buildRoute({ name: 'debate', id: accepted.investigation_id });
    } catch (failure) {
      const message = describeError(failure);
      setError(message);
      pushToast(message, { tone: 'tertiary', durationMs: 6000 });
    } finally {
      setBusy(false);
    }
  }

  const footer = (
    <>
      <span className="mr-auto inline-flex items-center gap-1.5 font-mono text-[10px] text-on-surface-variant">
        <Icon name="verified_user" size={12} className="text-secondary" />
        Investigation id is auto-assigned by the server on injection
      </span>
      <Button variant="ghost" onClick={onClose} disabled={busy}>
        Cancel
      </Button>
      <span className="flex items-center gap-1.5">
        <Button variant="primary" onClick={authorize} busy={busy} disabled={!canInject || selected === null}>
          {busy ? 'Authorizing…' : 'Authorize injection'}
        </Button>
        <Proof
          source="POST /investigations/simulate (wait=false)"
          n={1}
          asOf={null}
          label="Authorize injection"
          definition="Starts a simulated investigation from the selected real scenario, then opens the debate room by the returned investigation id. Runs in the background (wait=false); the agents are never told which scenario was chosen."
          inputs={[
            { label: 'scenario_label', value: selected ?? '—' },
            { label: 'max_rows_per_agent', value: String(maxRows) },
            { label: 'noise_pct', value: `${noise}%` },
          ]}
        />
      </span>
    </>
  );

  return (
    <Modal open={open} onClose={onClose} title="Inject simulated threat scenario" footer={footer}>
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary-container/40 bg-primary-container/20 text-primary">
            <Icon name="sync_alt" size={20} />
          </span>
          <p className="font-body text-xs text-on-surface-variant">
            Trigger a real scenario from the datasets into the multi-agent debate queue. The selection below is the only
            thing sent to the backend.
          </p>
        </div>

        {/* 1. Scenario, grouped by dataset */}
        <fieldset className="flex flex-col gap-3">
          <legend className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase text-on-surface-variant">
            1. Benchmark testbed scenario
            <Proof
              source="GET /scenarios"
              n={scenarios?.length ?? 0}
              asOf={scenariosQ.loadedAt}
              label="Scenario list"
              definition="The real labelled scenarios in the datasets, grouped by dataset. Each row count is the number of raw_logs rows for that label."
            />
          </legend>

          {scenariosQ.error !== null && scenarios === undefined ? (
            <EmptyState title="Scenarios unavailable" description={scenariosQ.error} icon="warning" />
          ) : scenarios === undefined ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <div role="radiogroup" aria-label="Benchmark scenario" className="flex flex-col gap-3">
              {groups.map((group) => (
                <div key={group.dataset} className="flex flex-col gap-1.5">
                  <span className="text-label uppercase text-outline">{group.title}</span>
                  <div className="flex flex-col gap-1.5">
                    {group.items.map((scenario) => {
                      const active = selected === scenario.label;
                      return (
                        <button
                          key={scenario.label}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => setSelected(scenario.label)}
                          className={cn(
                            'flex w-full flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors',
                            active
                              ? 'border-primary bg-primary/10'
                              : 'border-outline-variant/40 bg-surface-container-low hover:border-primary/40',
                          )}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="font-mono text-evidence text-on-surface">{scenario.label}</span>
                            <span className="inline-flex items-center gap-1 text-caption text-on-surface-variant">
                              rows
                              <Metric metric={scenario.row_count} size="body" label={`${scenario.label} row count`} />
                            </span>
                          </span>
                          <span className="text-caption text-on-surface-variant">{scenario.description}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </fieldset>

        {/* 2. Noise */}
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase text-on-surface-variant">
            2. Noise · benign-row dilution
            <Proof
              source="POST /investigations/simulate (noise_pct)"
              n={1}
              asOf={null}
              label="Noise level"
              definition="Real benign-row dilution: k = round(n · pct / 100) scenario rows are replaced by benign rows of the same source, preserving the event mix. The effective percentage is returned by the API and shown after the run starts."
            />
          </span>
          <div className="inline-flex gap-1 rounded-lg border border-outline-variant/40 bg-surface-container-low p-1">
            {NOISE_OPTIONS.map((option) => {
              const active = noise === option;
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setNoise(option)}
                  className={cn(
                    'cursor-pointer rounded px-3 py-1.5 font-mono text-evidence transition-colors',
                    active ? 'bg-primary-container text-on-primary' : 'text-on-surface-variant hover:text-on-surface',
                  )}
                >
                  {option}%
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. Max rows per agent */}
        <div className="flex flex-col gap-1.5">
          <Slider
            label="Max rows per agent"
            value={maxRows}
            min={1}
            max={15}
            step={1}
            onChange={setMaxRows}
            format={(value) => String(value)}
          />
          <span className="flex items-center gap-1.5 text-caption text-on-surface-variant">
            Rows handed to each investigator (1–15).
            <Proof
              source="POST /investigations/simulate (max_rows_per_agent)"
              n={1}
              asOf={null}
              label="Max rows per agent"
              definition="Upper bound on the number of raw_logs rows each investigator receives. Default 5."
            />
          </span>
        </div>

        {/* Blind-test note */}
        <div className="flex items-start gap-2 rounded-lg border border-secondary/40 bg-secondary/10 px-3 py-2">
          <Icon name="verified_user" size={12} className="mt-0.5 shrink-0 text-secondary" />
          <p className="flex flex-wrap items-center gap-1.5 text-caption text-on-surface-variant">
            Blind test: the chosen scenario label is never placed in any investigator&apos;s input. This is checked, not
            promised.
            <Proof
              source="backend/tests/agents/test_blind_boundary.py"
              n={1}
              asOf={null}
              label="Blind-test proof"
              definition="An AST scan, a seeded-secret test and a prompt test assert that the ground-truth scenario label cannot reach agent inputs (plan R9)."
            />
          </p>
        </div>

        {!canInject && (
          <p role="note" className="flex items-start gap-2 rounded-lg border border-tertiary/40 bg-tertiary/10 px-3 py-2 text-caption text-tertiary">
            <Icon name="error" size={12} className="mt-0.5 shrink-0" />
            Your role does not grant the inject_scenario capability, so injection is disabled.
          </p>
        )}

        {error !== null && (
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-error/40 bg-error-container/30 px-3 py-2 text-caption text-error">
            <Icon name="warning" size={12} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
