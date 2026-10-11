/** The pause and resume control for new investigations. */
import type { Settings } from '../../api/types';
import { formatNumber } from '../../lib/format';
import { Proof } from '../../ui/Proof';
import { Toggle } from '../../ui/Toggle';
import { CardTitle } from './shared';

export function IntakeControl({
  settings,
  canEdit,
  busy,
  onToggle,
}: {
  settings: Settings | undefined;
  canEdit: boolean;
  busy: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <div className="space-y-4 rounded-xl border border-outline-variant/40 bg-surface-container-low p-5">
      <CardTitle icon="admin_panel_settings">Autonomous intake control</CardTitle>
      <Toggle
        label="Pause new investigations"
        description="While on, POST /investigations/simulate is rejected with 423. Audited as settings_changed."
        checked={settings?.intake_paused ?? false}
        disabled={!canEdit || busy || !settings}
        onChange={onToggle}
      />
      {!canEdit ? <p className="font-body text-xs text-on-surface-variant">Changing this requires the edit_settings capability.</p> : null}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-outline-variant/40 bg-background p-3">
        <span className="inline-flex items-center gap-2 font-body text-xs text-on-surface-variant">
          Verdict-confidence threshold (read-only here)
          <Proof
            source="GET /settings.verdict_confidence_threshold"
            n={1}
            asOf={null}
            definition="The confidence a threat verdict needs before Self-Healing may contain the case (every contributing agent must also hold CrS of at least 50 %). It does not decide the class. Edited on the Trust & credibility screen, not here."
            label="Verdict threshold"
          />
        </span>
        <span className="font-mono text-sm text-primary">{settings ? formatNumber(settings.verdict_confidence_threshold, 2) : '—'}</span>
      </div>
    </div>
  );
}
