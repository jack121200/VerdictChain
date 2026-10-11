/** Start and stop of the simulated live feed: speed, the OpenAI gate and the automatic-investigation switch. */
import { useState } from 'react';
import { describeError, startLiveFeed, stopLiveFeed } from '../../api/client';
import type { LiveStatus } from '../../api/types';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/Select';
import { Toggle } from '../../ui/Toggle';
import { pushToast } from '../../ui/toast-store';

export const RATE_OPTIONS = [
  { value: '1', label: '1 row / s' },
  { value: '2', label: '2 rows / s' },
  { value: '4', label: '4 rows / s' },
  { value: '10', label: '10 rows / s' },
  { value: '25', label: '25 rows / s' },
] as const;
export type RateValue = (typeof RATE_OPTIONS)[number]['value'];

export const AFTER_OPTIONS = [
  { value: '300', label: '300 rows (quick test)' },
  { value: '1500', label: '1,500 rows' },
  { value: '3000', label: '3,000 rows' },
  { value: '5000', label: '5,000 rows' },
] as const;
export type AfterValue = (typeof AFTER_OPTIONS)[number]['value'];

export function Controls({ status, onChanged }: { status: LiveStatus; onChanged: () => void }) {
  const [rate, setRate] = useState<RateValue>('4');
  const [after, setAfter] = useState<AfterValue>('1500');
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState(false);
  const running = status.state === 'running';

  async function run(action: () => Promise<LiveStatus>, done: string) {
    setBusy(true);
    try {
      await action();
      pushToast(done, { tone: 'secondary' });
      onChanged();
    } catch (error) {
      pushToast(describeError(error), { tone: 'tertiary', durationMs: 6000 });
    } finally {
      setBusy(false);
    }
  }

  if (running) {
    return (
      <Button variant="secondary" icon="pause" busy={busy} onClick={() => void run(stopLiveFeed, 'Live feed stopped (audited).')}>
        Stop live feed
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-4">
      <Select<RateValue> label="Replay speed" value={rate} options={RATE_OPTIONS} onChange={setRate} disabled={busy} />
      <Select<AfterValue> label="Call OpenAI after" value={after} options={AFTER_OPTIONS} onChange={setAfter} disabled={busy} />
      <div className="min-w-56">
        <Toggle
          label="Start investigations automatically"
          description="Off: the monitor still scores windows, nothing starts."
          checked={auto}
          onChange={setAuto}
          disabled={busy}
        />
      </div>
      <Button
        variant="primary"
        icon="play_arrow"
        busy={busy}
        onClick={() =>
          void run(
            () => startLiveFeed({ events_per_second: Number(rate), auto_investigate: auto, llm_after_rows: Number(after) }),
            'Live feed started (audited).',
          )
        }
      >
        Start live feed
      </Button>
    </div>
  );
}
