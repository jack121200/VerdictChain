import { cn } from '../../lib/cn';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icon-names';
import { Proof } from '../../ui/Proof';
import type { ContainmentGate as Gate, GateOutcome, GateState } from './gate';

// A colour is never the only signal: each state has its own icon shape and word.
const STATE: Record<GateState, { icon: IconName; word: string; className: string }> = {
  pass: { icon: 'check_circle', word: 'Passed', className: 'text-secondary' },
  fail: { icon: 'cancel', word: 'Refused', className: 'text-error' },
  unknown: { icon: 'info', word: 'Not known yet', className: 'text-on-surface-variant' },
};

const OUTCOME: Record<GateOutcome, { word: string; className: string }> = {
  passed: { word: 'passed: the sandbox actions ran', className: 'border-secondary/40 text-secondary' },
  refused: { word: 'refused: nothing was contained', className: 'border-error/40 text-error' },
  manual: { word: 'contained by hand: an analyst ran it', className: 'border-tertiary/40 text-tertiary' },
  pending: { word: 'waiting for a verdict', className: 'border-outline-variant/40 text-on-surface-variant' },
  stopped: { word: 'no verdict: the debate stopped', className: 'border-error/40 text-error' },
};

/**
 * The four conditions the Self-Healing agent checks before it contains a case on its own, each with the numbers
 * it was judged on (gate.ts mirrors backend/self_healing/actions.should_respond). It answers "why was this case
 * not contained?" without anyone reading code.
 */
export function ContainmentGate({ gate, loadedAt }: { gate: Gate; loadedAt: string | null }) {
  const outcome = OUTCOME[gate.outcome];
  return (
    <section aria-label="Containment gate" className="flex flex-col gap-2 rounded-lg border border-outline-variant/30 bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 font-mono text-[10px] font-bold uppercase text-primary">
          <Icon name="shield" size={12} />
          Containment gate
        </span>
        <span className={cn('rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase', outcome.className)}>{outcome.word}</span>
      </div>

      <ol className="flex flex-col gap-1.5 font-mono text-[10px]">
        {gate.checks.map((check) => {
          const state = STATE[check.state];
          return (
            <li key={check.id} className="flex items-start gap-2 rounded border border-outline-variant/20 bg-surface-card p-2">
              <Icon name={state.icon} size={14} className={cn('mt-px shrink-0', state.className)} />
              <span className="flex min-w-0 flex-col">
                <span className="text-on-surface">
                  {check.title} <span className={cn('font-bold uppercase', state.className)}>· {state.word}</span>
                </span>
                <span className="text-on-surface-variant">{check.detail}</span>
              </span>
            </li>
          );
        })}
      </ol>

      <div className="flex items-center justify-end gap-2 font-mono text-[10px] text-on-surface-variant">
        {gate.refusal !== null && gate.outcome !== 'manual' ? <span className="text-error">{gate.refusal}</span> : null}
        <Proof
          source="browser derivation of GET /investigations/{id} (status, votes, credibility) and GET /settings"
          n={gate.checks.filter((check) => check.state !== 'unknown').length}
          asOf={loadedAt}
          label="Containment gate"
          definition="Mirrors should_respond in backend/self_healing/actions.py. Self-Healing contains a case on its own only when (1) the debate reached a verdict, (2) the class has actions (external: ddos, port_scan, brute_force, botnet_c2; insider: file exfiltration, logon anomaly), (3) the verdict confidence is at or above the containment floor (verdict_confidence_threshold) and (4) every supporting agent's credibility after its last round is at or above the starting CrS (the autonomous-action floor). An analyst can still contain a case by hand; that route skips this gate."
        />
      </div>
    </section>
  );
}
