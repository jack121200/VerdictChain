/** Manual, sandboxed containment and its release for one investigation. */
import { useState } from 'react';
import { describeError, emergencyContainment, releaseContainment } from '../../api/client';
import { formatCountNoun } from '../../lib/format';
import { Button } from '../../ui/Button';
import { CONTROL_BORDER, FOCUS_RING } from '../../ui/classes';
import { Proof } from '../../ui/Proof';
import { pushToast } from '../../ui/toast-store';
import { CardTitle } from './shared';

export function EmergencyContainment() {
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function act(kind: 'run' | 'release'): Promise<void> {
    const target = id.trim();
    if (target === '') {
      pushToast('Enter an investigation id first.', { tone: 'tertiary' });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      if (kind === 'run') {
        const result = await emergencyContainment(target);
        setNote(`Containment ran: ${formatCountNoun(result.actions.length, 'sandboxed action')}. Status ${result.status}.`);
        pushToast('Sandboxed containment recorded.', { tone: 'secondary' });
      } else {
        const result = await releaseContainment(target);
        setNote(`Released: ${formatCountNoun(result.released.length, 'action')} reverted. Status ${result.status}.`);
        pushToast('Containment released.', { tone: 'secondary' });
      }
    } catch (cause) {
      pushToast(describeError(cause), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-outline-variant/40 bg-surface-container-low p-5">
      <div className="flex items-center justify-between">
        <CardTitle icon="warning" iconClass="text-error">
          Emergency containment
        </CardTitle>
        <Proof
          source="POST /investigations/{id}/emergency-containment · /release-containment"
          n={1}
          asOf={null}
          definition="Re-derives the containment plan from the round-3 transcripts (no LLM) and runs it in the sandbox (is_simulated stays true). Release reverts it. Both are audited."
          label="Emergency containment"
        />
      </div>
      <p className="font-body text-xs text-on-surface-variant">Per-investigation, sandbox-only. Enter an investigation id to run or release containment.</p>
      <input
        type="text"
        value={id}
        onChange={(event) => setId(event.target.value)}
        placeholder="Investigation id"
        aria-label="Investigation id"
        className={`w-full rounded-lg ${CONTROL_BORDER} bg-surface-container-low px-3 py-2 font-mono text-xs text-on-surface placeholder:text-on-surface-variant ${FOCUS_RING}`}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" icon="warning" busy={busy} onClick={() => act('run')}>
          Run sandboxed containment
        </Button>
        <Button variant="secondary" icon="sync_alt" busy={busy} onClick={() => act('release')}>
          Release
        </Button>
      </div>
      {note ? <p className="rounded-lg border border-outline-variant/40 bg-background p-2.5 font-mono text-xs text-on-surface">{note}</p> : null}
    </div>
  );
}
