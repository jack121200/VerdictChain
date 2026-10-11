/**
 * The Self-Healing agent for one case: the gate it checked (why it acted, or why it did not), the playbook it ran in
 * the sandbox step by step, and the proof that nothing reached a real system. Every line is an API field or a
 * check of API fields; the gate rules are containmentGate() in features/debate/gate.ts.
 */
import type { InvestigationDetail, InvestigationStatus, InvestigatorId, Settings, VerdictClass } from '../../api/types';
import { cn } from '../../lib/cn';
import { formatCount, formatDuration, shortId } from '../../lib/format';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icon-names';
import { Pill } from '../../ui/Pill';
import { Proof } from '../../ui/Proof';
import { Skeleton } from '../../ui/Skeleton';
import { containmentGate, type GateState } from '../debate/gate';
import { healingStatus, playbook } from './healing';

const GATE_ICON: Record<GateState, IconName> = { pass: 'check_circle', fail: 'cancel', unknown: 'schedule' };
const GATE_TONE: Record<GateState, string> = { pass: 'text-secondary', fail: 'text-error', unknown: 'text-outline' };

export interface SelfHealingPanelProps {
  detail: InvestigationDetail | undefined;
  detailError?: string;
  status: InvestigationStatus | null;
  verdictClass: VerdictClass | null;
  confidence: number | null;
  settings: Settings | undefined;
  agentName: (agentId: InvestigatorId) => string;
  /** The case's verdict_reached audit time (ISO), null when not recorded. */
  verdictAt: string | null;
  loadedAt: string | null;
  caseId: string;
  releaseBusy: boolean;
  /** Runs the inverse sandbox actions; the server checks the capability and audits it. */
  onRelease: () => void;
}

export function SelfHealingPanel({ detail, detailError, status, verdictClass, confidence, settings, agentName, verdictAt, loadedAt, caseId, releaseBusy, onRelease }: SelfHealingPanelProps) {
  const steps = playbook(detail?.actions ?? [], verdictAt);
  const gate = containmentGate({
    status,
    verdictClass,
    verdictConfidence: confidence,
    floor: settings?.verdict_confidence_threshold ?? null,
    credibilityFloor: settings?.starting_crs ?? null,
    votes: detail?.votes ?? [],
    credibility: detail?.credibility ?? [],
    actions: detail?.actions ?? [],
    agentName,
  });
  const standing = healingStatus(gate, status, verdictClass, steps);
  const simulated = steps.filter((step) => step.simulated).length;

  return (
    <section aria-label="Self-Healing agent" className="space-y-3 rounded-lg border border-error/30 bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-md border border-error/40 bg-error-container/20 font-mono text-sm text-error">Σ</span>
          <span className="font-mono text-[10px] font-semibold uppercase text-outline">Self-Healing agent</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Pill tone={standing.tone} icon={standing.icon}>{standing.label}</Pill>
          <Proof
            source="GET /investigations/{id} (actions, votes, credibility) · GET /settings · GET /audit-trail"
            n={steps.length}
            asOf={loadedAt}
            label="Self-Healing agent"
            definition="The gate mirrors should_respond() in backend/self_healing/actions.py: a verdict, a class that has actions, confidence at or above the containment floor (GET /settings verdict_confidence_threshold), and every supporting agent's CrS at or above the starting CrS (GET /settings starting_crs). The playbook is this case's response_actions rows, oldest first, with the time after the verdict_reached audit entry."
            inputs={[
              { label: 'verdict at', value: verdictAt ?? 'not recorded' },
              { label: 'confidence floor', value: settings ? String(settings.verdict_confidence_threshold) : 'not loaded' },
              { label: 'credibility floor', value: settings ? String(settings.starting_crs) : 'not loaded' },
            ]}
          />
        </span>
      </div>

      <p className="font-body text-xs text-on-surface-variant">{standing.sentence}</p>

      {detail === undefined ? (
        detailError ? <p className="font-mono text-[11px] text-on-surface-variant">— {detailError}</p> : <Skeleton className="h-16 w-full" />
      ) : (
        <>
          <div className="space-y-1.5">
            <span className="font-mono text-[10px] uppercase text-outline">Gate</span>
            <ul className="space-y-1">
              {gate.checks.map((check) => (
                <li key={check.id} className="flex items-start gap-2 text-[11px]">
                  <Icon name={GATE_ICON[check.state]} size={14} className={cn('mt-0.5 shrink-0', GATE_TONE[check.state])} />
                  <span className="min-w-0">
                    <span className="text-on-surface">{check.title}</span>
                    <span className="block text-on-surface-variant">{check.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-1.5">
            <span className="font-mono text-[10px] uppercase text-outline">Playbook</span>
            {steps.length === 0 ? (
              <p className="font-mono text-[11px] text-on-surface-variant">No sandbox action was run for this case.</p>
            ) : (
              <ol className="space-y-2">
                {steps.map((step, index) => (
                  <li key={step.id} className="flex gap-2">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-error/40 font-mono text-[10px] text-error">{index + 1}</span>
                    <div className="min-w-0 flex-1 text-[11px]">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="font-semibold text-on-surface">{step.label}</span>
                        <span className="font-mono text-on-surface-variant">→ {step.target}</span>
                        <Pill tone={step.simulated ? 'secondary' : 'error'} icon={step.simulated ? 'check' : 'warning'}>{step.simulated ? 'Simulated' : 'Not simulated'}</Pill>
                        {step.offsetMs !== null && <span className="font-mono text-outline">+{formatDuration(Math.max(0, step.offsetMs))} after the verdict</span>}
                      </div>
                      {step.reason && <p className="mt-0.5 break-words text-on-surface-variant">“{step.reason}”</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-outline-variant/40 pt-2 font-mono text-[11px]">
            <span className={cn('inline-flex items-center gap-1.5', steps.length > 0 && simulated < steps.length ? 'text-error' : 'text-on-surface-variant')}>
              <Icon name="gpp_good" size={14} className={steps.length > 0 && simulated < steps.length ? 'text-error' : 'text-secondary'} />
              {steps.length === 0 ? 'Sandbox boundary: nothing was run' : `Sandbox boundary: ${formatCount(simulated)} of ${formatCount(steps.length)} actions simulated`}
              <Proof
                source="response_actions.is_simulated · backend/self_healing/sandbox.py"
                n={steps.length}
                asOf={loadedAt}
                label="Sandbox boundary"
                definition="Each action row carries is_simulated. The sandbox module imports no networking library, so it cannot reach another system; backend/tests/self_healing/test_sandbox.py (test_module_has_no_networking_imports) fails the build if it ever does."
              />
            </span>
            {status === 'contained' && (
              <span className="inline-flex items-center gap-1.5">
                <Button variant="ghost" size="sm" icon="replay" busy={releaseBusy} disabled={releaseBusy} onClick={onRelease}>
                  Release containment
                </Button>
                <Proof
                  source={`POST /investigations/${shortId(caseId)}/release-containment`}
                  n={1}
                  asOf={null}
                  label="Release containment"
                  definition="Runs the inverse sandbox actions (audited). The actions are simulated; no real system is reachable."
                />
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
