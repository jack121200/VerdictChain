import type { AllowanceStatus } from '../api/types';
import { Metric } from './Metric';
import { Timestamp } from './Timestamp';

/**
 * What OpenAI itself allows this key, from the x-ratelimit-* headers of its latest answer: the numbers a debate
 * has to fit inside. Every value is a Metric: before OpenAI has answered there is no reading, so each shows an
 * em dash with its reason, never a made-up 0.
 */
export function AllowanceRows({ allowance }: { allowance: AllowanceStatus | undefined }) {
  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label="What OpenAI allows this key">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase text-on-surface-variant">Requests left</div>
          <Metric metric={allowance?.requests_left} size="body" label="OpenAI requests left for this key" />
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase text-on-surface-variant">Requests allowed</div>
          <Metric metric={allowance?.requests_allowed} size="body" label="OpenAI requests allowed for this key" />
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase text-on-surface-variant">Tokens left</div>
          <Metric metric={allowance?.tokens_left} size="body" label="OpenAI tokens left for this key" />
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase text-on-surface-variant">Tokens allowed</div>
          <Metric metric={allowance?.tokens_allowed} size="body" label="OpenAI tokens allowed for this key" />
        </div>
      </div>
      {allowance?.held_until != null && (
        <p className="text-caption text-error" role="status">
          OpenAI asked for a wait: nothing is sent to it until <Timestamp iso={allowance.held_until} mode="clock" />.
        </p>
      )}
    </div>
  );
}
