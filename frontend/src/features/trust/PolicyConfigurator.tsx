/** The policy configurator: the eta, isolation and verdict-floor settings. */
import { useEffect, useState } from 'react';
import { describeError, updateSettings } from '../../api/client';
import type { Metric as MetricEnvelope, SettingsUpdate } from '../../api/types';
import { cn } from '../../lib/cn';
import { formatNumber, formatPercent } from '../../lib/format';
import { Icon } from '../../ui/Icon';
import { Metric } from '../../ui/Metric';
import { Proof } from '../../ui/Proof';
import { Timestamp } from '../../ui/Timestamp';
import { pushToast } from '../../ui/toast-store';

// ---- Section 5: policy configurator --------------------------------------------

export interface SettingsView {
  eta: number;
  isolation_threshold: number;
  verdict_confidence_threshold: number;
  intake_paused: boolean;
}

export function PolicyConfigurator({
  settings,
  settingsUpdatedBy,
  settingsUpdatedAt,
  canEdit,
  sandboxViolations,
  onApplied,
}: {
  settings: SettingsView | undefined;
  settingsUpdatedBy: string | null;
  settingsUpdatedAt: string | null;
  canEdit: boolean;
  sandboxViolations: MetricEnvelope<number> | undefined;
  onApplied: () => void;
}) {
  const [draft, setDraft] = useState<SettingsUpdate | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings) {
      setDraft((prev) =>
        prev ?? {
          eta: settings.eta,
          isolation_threshold: settings.isolation_threshold,
          verdict_confidence_threshold: settings.verdict_confidence_threshold,
          intake_paused: settings.intake_paused,
        },
      );
    }
  }, [settings]);

  function reset() {
    if (!settings) return;
    setDraft({
      eta: settings.eta,
      isolation_threshold: settings.isolation_threshold,
      verdict_confidence_threshold: settings.verdict_confidence_threshold,
      intake_paused: settings.intake_paused,
    });
  }

  async function apply() {
    if (!draft) return;
    setBusy(true);
    try {
      const next = await updateSettings(draft);
      setDraft({
        eta: next.eta,
        isolation_threshold: next.isolation_threshold,
        verdict_confidence_threshold: next.verdict_confidence_threshold,
        intake_paused: next.intake_paused,
      });
      onApplied();
      pushToast('Runtime settings updated (audited).', { tone: 'secondary' });
    } catch (error) {
      pushToast(describeError(error), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5 rounded-xl border border-outline-variant/40 bg-surface-container-low p-5 shadow-md">
      <div className="flex flex-col justify-between gap-3 border-b border-outline-variant/30 pb-2 md:flex-row md:items-center">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Icon name="admin_panel_settings" size={20} className="text-secondary" />
            <h2 className="font-headline text-base font-bold text-on-surface">Runtime policy configurator</h2>
          </div>
          <p className="font-body text-xs text-on-surface-variant">
            The three editable runtime thresholds. Apply and reset call PUT /settings, which is RBAC-gated and audited.
            Containment actions always run in a sandbox.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-secondary/30 bg-secondary-container/20 px-3 py-1 font-mono text-[10px] font-semibold uppercase text-secondary shadow-sm">
          <span className="h-2 w-2 rounded-full bg-secondary" aria-hidden="true" />
          <span className="inline-flex items-center gap-1">
            Sandbox violations:
            <Metric size="body" className="text-secondary" label="Sandbox simulated-violation count" metric={sandboxViolations} />
          </span>
        </div>
      </div>

      {!canEdit ? (
        <div className="space-y-3">
          <p className="rounded-lg border border-outline-variant/40 bg-surface-card p-3 font-body text-xs text-on-surface-variant">
            Editing runtime settings requires the <code className="font-mono text-on-surface">edit_settings</code> capability.
            The current values are read-only for your role.
          </p>
          <div className="grid grid-cols-1 gap-4 font-mono text-xs md:grid-cols-3">
            <ReadOnlyValue label="Learning rate η" value={settings ? formatNumber(settings.eta, 2) : '—'} />
            <ReadOnlyValue label="Isolation threshold" value={settings ? formatPercent(settings.isolation_threshold, 0) : '—'} />
            <ReadOnlyValue label="Verdict confidence floor" value={settings ? formatPercent(settings.verdict_confidence_threshold, 0) : '—'} />
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <PolicySlider
              label="Learning rate η"
              description="How strongly each round's verification result moves an agent's credibility (compute_crs)."
              value={draft?.eta ?? 0}
              min={0.01}
              max={0.5}
              step={0.01}
              accent="primary"
              display={(value) => formatNumber(value, 2)}
              disabled={draft === null}
              onChange={(value) => setDraft((prev) => (prev ? { ...prev, eta: value } : prev))}
              proof="GET /settings.eta · PUT /settings"
              proofDef="Credibility learning rate η in [0.01, 0.5]. Used by compute_crs = clamp(c·(1 + η·(2·rate − 1)), 0, 1)."
            />
            <PolicySlider
              label="Isolation threshold"
              description="CrS below this value after a round quarantines the investigator until an analyst restores it."
              value={draft?.isolation_threshold ?? 0}
              min={0.05}
              max={0.45}
              step={0.01}
              accent="secondary"
              display={(value) => formatPercent(value, 0)}
              disabled={draft === null}
              onChange={(value) => setDraft((prev) => (prev ? { ...prev, isolation_threshold: value } : prev))}
              proof="GET /settings.isolation_threshold · PUT /settings"
              proofDef="Isolation threshold in [0.05, 0.45]. An agent below it after a round is quarantined and excluded from the verdict."
            />
            <PolicySlider
              label="Verdict confidence floor"
              description="Minimum verdict confidence for automatic sandbox containment. A verdict below it still stands; it is just not contained."
              value={draft?.verdict_confidence_threshold ?? 0}
              min={0.5}
              max={0.99}
              step={0.01}
              accent="primary"
              display={(value) => formatPercent(value, 0)}
              disabled={draft === null}
              onChange={(value) => setDraft((prev) => (prev ? { ...prev, verdict_confidence_threshold: value } : prev))}
              proof="GET /settings.verdict_confidence_threshold · PUT /settings"
              proofDef="Verdict confidence threshold in [0.50, 0.99]. Self-Healing contains a case only when the verdict is a threat class, its confidence reaches this floor and every contributing agent's CrS is at least 50 % (backend/self_healing/actions.py should_respond). It does not decide which class wins; the vote does."
            />
          </div>

          <div className="flex flex-col justify-between gap-3 border-t border-outline-variant/30 pt-2 sm:flex-row sm:items-center">
            <div className="flex items-center gap-1.5 font-mono text-[10px] text-on-surface-variant">
              <Icon name="verified_user" size={16} className="text-primary" />
              <span>
                Last changed by {settingsUpdatedBy ?? 'system'}
                {settingsUpdatedAt ? <> · <Timestamp iso={settingsUpdatedAt} /></> : ' · not yet changed'}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={reset}
                disabled={busy || draft === null}
                className="cursor-pointer rounded border border-outline-variant/40 bg-surface-card px-4 py-1.5 font-mono text-xs uppercase text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:opacity-50"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={apply}
                disabled={busy || draft === null}
                className="flex cursor-pointer items-center gap-1.5 rounded bg-primary-container px-4 py-1.5 font-mono text-xs font-bold uppercase text-on-primary shadow-glow-cyan transition-all hover:bg-primary disabled:opacity-50"
              >
                <Icon name="sync_alt" size={16} className={busy ? 'animate-spin' : undefined} />
                <span>{busy ? 'Applying…' : 'Apply settings'}</span>
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export function ReadOnlyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-card p-4">
      <span className="block text-[10px] font-semibold uppercase text-on-surface-variant">{label}</span>
      <span className="mt-1 block text-primary">{value}</span>
    </div>
  );
}

export function PolicySlider({
  label,
  description,
  value,
  min,
  max,
  step,
  accent,
  display,
  disabled,
  onChange,
  proof,
  proofDef,
}: {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step: number;
  accent: 'primary' | 'secondary';
  display: (value: number) => string;
  disabled: boolean;
  onChange: (value: number) => void;
  proof: string;
  proofDef: string;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface-card p-4">
      <div className="flex items-center justify-between font-mono text-xs">
        <span className="font-semibold uppercase text-on-surface">{label}</span>
        <span className="inline-flex items-center gap-1">
          <span className={cn('font-bold', accent === 'primary' ? 'text-primary' : 'text-secondary')}>{display(value)}</span>
          <Proof source={proof} n={1} asOf={null} definition={proofDef} label={label} />
        </span>
      </div>
      <p className="font-body text-xs text-on-surface-variant">{description}</p>
      <div className="space-y-1">
        <input
          type="range"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
          className={cn(
            'h-1.5 w-full cursor-pointer rounded-lg bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50',
            accent === 'primary' ? 'accent-primary-container' : 'accent-secondary',
          )}
        />
        <div className="flex justify-between font-mono text-[9px] text-on-surface-variant">
          {/* The ends and the middle of the track, formatted like the value, so a tick is what the slider reads there. */}
          <span>{display(min)}</span>
          <span>{display((min + max) / 2)}</span>
          <span>{display(max)}</span>
        </div>
      </div>
    </div>
  );
}
