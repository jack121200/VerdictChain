/**
 * What the Self-Healing agent did for one case, as a playbook: its sandboxed actions in the order they ran, how long
 * after the verdict each one came, and one sentence for where the case stands. The gate (why it acted, or why not)
 * is containmentGate() in features/debate/gate.ts, which mirrors backend/self_healing/actions.py.
 */
import type { InvestigationStatus, ResponseAction, VerdictClass } from '../../api/types';
import type { Tone } from '../../ui/classes';
import type { IconName } from '../../ui/icon-names';
import type { ContainmentGate } from '../debate/gate';

/** The four sandbox actions of backend/self_healing/sandbox.py, in words. */
export const ACTION_LABEL: Readonly<Record<string, string>> = {
  lock_account: 'Lock account',
  block_ip_range: 'Block IP range',
  trigger_rate_limiting: 'Apply rate limiting',
  trigger_audit: 'Open an audit',
};

/** A release row is the inverse of an action and is stored as `release:<action>`. */
export function actionLabel(actionType: string): string {
  if (actionType.startsWith('release:')) {
    const original = actionType.slice('release:'.length);
    return `Release: ${ACTION_LABEL[original] ?? original}`;
  }
  return ACTION_LABEL[actionType] ?? actionType;
}

export interface PlaybookStep {
  id: string;
  actionType: string;
  label: string;
  target: string;
  /** The one sentence the action carries (written by the model for an automatic action). */
  reason: string | null;
  simulated: boolean;
  /** An inverse action that undid an earlier one. */
  released: boolean;
  /** Milliseconds after the verdict entry, null when the verdict time is not known. */
  offsetMs: number | null;
}

/** The actions oldest first. verdictAt is the case's verdict_reached audit time (ISO) or null. */
export function playbook(actions: readonly ResponseAction[], verdictAt: string | null): PlaybookStep[] {
  const verdictMs = verdictAt === null ? Number.NaN : Date.parse(verdictAt);
  return [...actions]
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id))
    .map((action) => {
      const ms = Date.parse(action.created_at);
      return {
        id: action.id,
        actionType: action.action_type,
        label: actionLabel(action.action_type),
        target: action.target,
        reason: action.reason,
        simulated: action.is_simulated,
        released: action.action_type.startsWith('release:'),
        offsetMs: Number.isNaN(verdictMs) || Number.isNaN(ms) ? null : ms - verdictMs,
      };
    });
}

export interface HealingStatus {
  tone: Tone | 'neutral';
  icon: IconName;
  label: string;
  sentence: string;
}

/** Where the case stands with the Self-Healing agent, in one label and one sentence. */
export function healingStatus(
  gate: ContainmentGate,
  status: InvestigationStatus | null,
  verdictClass: VerdictClass | null,
  steps: readonly PlaybookStep[],
): HealingStatus {
  if (status === 'contained') {
    return {
      tone: gate.outcome === 'manual' ? 'tertiary' : 'secondary',
      icon: 'shield',
      label: gate.outcome === 'manual' ? 'Contained by an analyst' : 'Contained in the sandbox',
      sentence:
        gate.outcome === 'manual'
          ? 'A gate check failed, but an analyst ran containment by hand. That route skips the gate and is audited.'
          : 'Every gate check passed, so the agent ran its playbook in the sandbox. No real system was reachable.',
    };
  }
  // A release sends the case back to verdict_reached with the inverse actions stored beside the originals.
  if (steps.some((step) => step.released)) {
    return { tone: 'primary', icon: 'replay', label: 'Released', sentence: 'An analyst released the sandbox actions. The release is audited and simulated too.' };
  }
  if (gate.outcome === 'pending') return { tone: 'neutral', icon: 'schedule', label: 'Waiting for a verdict', sentence: 'The agent acts only after the debate has a verdict.' };
  if (gate.outcome === 'stopped') return { tone: 'neutral', icon: 'cancel', label: 'No verdict', sentence: 'The debate stopped before a verdict, so there was nothing to contain.' };
  if (verdictClass === 'benign' || verdictClass === 'ambiguous') {
    return {
      tone: 'neutral',
      icon: 'check_circle',
      label: 'No action needed',
      sentence: verdictClass === 'benign' ? 'The agents read the rows as benign. Benign verdicts plan no containment.' : 'The verdict is ambiguous. The agent never acts on a case the debate could not decide.',
    };
  }
  if (gate.outcome === 'refused') {
    return { tone: 'tertiary', icon: 'gpp_bad', label: 'Held by the gate', sentence: gate.refusal ?? 'A gate check failed, so the agent did not act.' };
  }
  return { tone: 'neutral', icon: 'shield', label: 'Ready', sentence: 'The gate is open; containment runs right after the verdict.' };
}
