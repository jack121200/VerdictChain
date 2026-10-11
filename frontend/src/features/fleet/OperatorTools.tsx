/** The operator tools of an investigator's inspector: credibility history, fault-injection dry run, quarantine and restore. */
import { useState } from 'react';
import { describeError, getCredibilityHistory, injectFault, quarantineAgent, restoreAgent } from '../../api/client';
import type { FaultInjectionResponse, FaultKind, FleetEntry, InvestigatorId } from '../../api/types';
import { useAsync } from '../../app/use-async';
import { cn } from '../../lib/cn';
import { formatCount, formatNumber } from '../../lib/format';
import { Button } from '../../ui/Button';
import { CONTROL_BORDER, FOCUS_RING } from '../../ui/classes';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { Metric } from '../../ui/Metric';
import { Proof } from '../../ui/Proof';
import { Select } from '../../ui/Select';
import { Slider } from '../../ui/Slider';
import { TrajectoryChart } from '../../ui/TrajectoryChart';
import { pushToast } from '../../ui/toast-store';
import { BoxLabel, Field, percent, productionCrs } from './shared';

export function CredibilityHistoryChart({ agentId, isolationThreshold }: { agentId: InvestigatorId; isolationThreshold: number | undefined }) {
  const history = useAsync(() => getCredibilityHistory(agentId, { limit: 60 }), undefined, ['credibility'], [agentId]);
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

export function FaultInjectionPanel({ agentId }: { agentId: InvestigatorId }) {
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
    result?.citation.status === 'VERIFIED' ? 'text-secondary' : result?.citation.status === 'DISCREPANCY' ? 'text-tertiary' : 'text-error';
  const points = result?.projected_trajectory.map((point) => ({ x: point.round, y: point.projected_crs_after })) ?? [];

  return (
    <div className="space-y-3 rounded-xl border border-outline-variant/40 bg-background p-3.5">
      <BoxLabel
        trailing={
          <Proof
            source="POST /agents/{id}/fault-injection"
            n={result?.projected_trajectory.length ?? 0}
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
              {result.citation.status} · {result.citation.reason}
            </span>
          </Field>
          <TrajectoryChart
            label="Projected credibility trajectory"
            series={[{ id: 'projected', label: 'Projected CrS', tone: 'tertiary', points }]}
            xDomain={[1, Math.max(1, rounds)]}
            yDomain={[0, 1]}
            threshold={{ value: result.isolation_threshold, label: 'Isolation' }}
            xLabel="Round"
            yLabel="CrS"
            proof={{
              source: 'POST /agents/{id}/fault-injection projected',
              n: points.length,
              asOf: null,
              definition: 'Projected CrS per round with compute_crs using the live eta and isolation threshold.',
              inputs: [
                { label: 'eta', value: formatNumber(result.eta, 3) },
                { label: 'isolation_threshold', value: formatNumber(result.isolation_threshold, 2) },
              ],
            }}
          />
          <div className="flex flex-col gap-2 rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] font-semibold uppercase text-outline">Production credibility</span>
              <span className={cn('font-mono text-xs font-bold uppercase', result.production_crs_unchanged ? 'text-secondary' : 'text-error')}>
                {result.production_crs_unchanged ? 'Unchanged' : 'Changed'}
              </span>
            </div>
            <Field label="Before">
              <Metric metric={productionCrs(result.production_crs_before)} size="body" format={percent} label="Production CrS before" />
            </Field>
            <Field label="After">
              <Metric metric={productionCrs(result.production_crs_after)} size="body" format={percent} label="Production CrS after" />
            </Field>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function QuarantineControls({ agent, onChanged }: { agent: FleetEntry; onChanged: () => void }) {
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
        className={`w-full rounded-lg ${CONTROL_BORDER} bg-surface-container-low px-3 py-2 font-mono text-xs text-on-surface placeholder:text-on-surface-variant ${FOCUS_RING}`}
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
