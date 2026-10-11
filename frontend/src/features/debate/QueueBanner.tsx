import { useEffect, useRef } from 'react';
import { getInvestigationProgress } from '../../api/client';
import { buildRoute } from '../../app/router';
import { useAsync } from '../../app/use-async';
import { formatDuration, shortId } from '../../lib/format';
import { CopyButton } from '../../ui/CopyHash';
import { Icon } from '../../ui/Icon';
import { Proof } from '../../ui/Proof';

/**
 * Shown while the investigation waits in the debate queue. Everything on it is a field of
 * GET /investigations/{id}/progress. When the worker takes the case the phase leaves 'queued' and the room
 * reloads, so the live debate appears without a click.
 */
export function QueueBanner({ investigationId, onLeftQueue }: { investigationId: string; onLeftQueue: () => void }) {
  const progress = useAsync(() => getInvestigationProgress(investigationId), 2000, ['investigations'], [investigationId]);
  const phase = progress.data?.phase;
  const fired = useRef(false);
  useEffect(() => {
    if (phase !== undefined && phase !== 'queued' && !fired.current) {
      fired.current = true;
      onLeftQueue();
    }
  }, [phase, onLeftQueue]);

  const position = progress.data?.queue_position ?? null;
  const length = progress.data?.queue_length ?? null;
  const waitingFor = progress.data?.waiting_for ?? null;
  return (
    <section
      role="status"
      className="flex flex-col gap-2 rounded-xl border border-outline-variant/40 bg-surface-container-low p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <Icon name="schedule" size={22} className="mt-0.5 text-on-surface-variant" />
        <div className="flex flex-col gap-1">
          <span className="font-headline text-sm font-bold uppercase tracking-wider text-on-surface">
            Waiting in the debate queue
            {position !== null && length !== null ? ` · place ${position} of ${length}` : ''}
          </span>
          <span className="text-caption text-on-surface-variant">
            Several debates run side by side, one per debate slot, and every slot is busy. This case starts by itself as soon as
            a slot frees up and the ones ahead of it have started.
            {waitingFor !== null && (
              <>
                {' '}
                Longest-running now:{' '}
                <a className="font-mono text-primary underline" href={buildRoute({ name: 'debate', id: waitingFor })}>
                  {shortId(waitingFor)}
                </a>{' '}
                <CopyButton value={waitingFor} label="investigation id" />
                .
              </>
            )}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 font-mono text-[10px] text-on-surface-variant">
        {progress.data !== undefined && <span>waiting {formatDuration(progress.data.elapsed_seconds * 1000)}</span>}
        <Proof
          source={`GET /investigations/${shortId(investigationId)}/progress`}
          n={length ?? 0}
          asOf={progress.loadedAt}
          label="Queue position"
          definition="queue_position = investigations with status queued that were accepted before this one, plus 1 (ordered by queued_at). queue_length = investigations with status queued. waiting_for = the debate that has held a slot the longest (every slot is busy while this one waits)."
        />
      </div>
    </section>
  );
}
