/** The OpenAI card of the Live screen: gate state, budget and what OpenAI itself allows. */
import type { LiveLlmState, LiveStatus } from '../../api/types';
import { cn } from '../../lib/cn';
import { formatCount, formatDuration, formatNumber } from '../../lib/format';
import { AllowanceRows } from '../../ui/AllowanceRows';
import { Card } from '../../ui/Card';
import type { IconName } from '../../ui/icon-names';
import { Metric } from '../../ui/Metric';
import { Pill } from '../../ui/Pill';
import { Proof } from '../../ui/Proof';

export const LLM_STATE: Record<LiveLlmState, { label: string; tone: 'neutral' | 'primary' | 'secondary' | 'tertiary' | 'error'; icon: IconName }> = {
  off: { label: 'Off', tone: 'neutral', icon: 'pause' },
  not_configured: { label: 'Not configured', tone: 'tertiary', icon: 'warning' },
  warming_up: { label: 'Warming up', tone: 'primary', icon: 'schedule' },
  active: { label: 'Active', tone: 'secondary', icon: 'bolt' },
  budget_reached: { label: 'Budget reached', tone: 'error', icon: 'block' },
  allowance_reached: { label: 'Key limit reached', tone: 'error', icon: 'block' },
};

/** The language model behind the automatic investigations: how far the feed is from switching it on, and what it has used. */
export function LlmCard({ live, loadedAt }: { live: LiveStatus; loadedAt: string | null }) {
  const llm = live.llm;
  const state = LLM_STATE[llm.state];
  const seen = llm.rows_seen.value ?? 0;
  const needed = llm.activation_rows.value;
  const ratio = needed === null || needed <= 0 ? 0 : Math.min(seen / needed, 1);
  const remaining = needed === null ? null : Math.max(needed - seen, 0);
  const rate = live.rate.value;
  const etaSeconds = remaining !== null && remaining > 0 && rate !== null && rate > 0 ? remaining / rate : null;
  const used = llm.tokens_24h.value;
  const limit = llm.token_limit.value;
  const usedRatio = used === null || limit === null || limit <= 0 ? 0 : Math.min(used / limit, 1);
  return (
    <section aria-label="Language model">
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col">
            <span className="font-headline text-body font-semibold text-on-surface">Language model: OpenAI</span>
            <span className="font-mono text-[10px] text-on-surface-variant">
              answers every debate{llm.model ? ` · ${llm.model}` : ''}
            </span>
          </div>
          <Pill tone={state.tone} icon={state.icon}>
            {state.label}
          </Pill>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between font-mono text-[11px] text-on-surface-variant">
            <span className="uppercase">Rows streamed before the first call</span>
            <span className="inline-flex items-center gap-1.5 tabular-nums text-on-surface">
              {formatCount(seen)} / {needed === null ? '—' : formatCount(needed)}
              <Proof
                source="GET /live/status (llm)"
                n={llm.rows_seen.n}
                asOf={loadedAt}
                label="OpenAI activation"
                definition="The monitor scores windows from the first row, locally and for free. No OpenAI call is made until the feed has streamed the number of rows chosen at start; after that, a flagged window may start a debate whose investigators and action reasons are written by OpenAI."
                inputs={[
                  { label: 'rows seen', value: formatCount(seen) },
                  { label: 'chosen at start', value: needed === null ? 'the feed has not been started' : formatCount(needed) },
                  { label: 'rate', value: rate === null ? '—' : `${formatNumber(rate, 1)} rows / s` },
                ]}
              />
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Rows streamed before OpenAI is called"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(ratio * 100)}
            className="h-2 w-full overflow-hidden rounded-full bg-surface-container-highest"
          >
            <div
              className={cn('h-full rounded-full', llm.state === 'active' ? 'bg-secondary' : 'bg-linear-to-r from-primary-container to-primary')}
              style={{ width: `${ratio * 100}%` }}
            />
          </div>
          <p className="text-caption text-on-surface-variant">
            {llm.state === 'not_configured'
              ? 'Set OPENAI_API_KEY in .env: without it no automatic investigation can run.'
              : llm.state === 'off'
                ? 'Start the live feed: the row count starts from zero every time.'
                : llm.state === 'warming_up'
                  ? `No OpenAI call has been made. ${formatCount(remaining ?? 0)} more rows${
                      etaSeconds === null ? '' : `, about ${formatDuration(etaSeconds * 1000)} at the current rate`
                    }.`
                  : llm.state === 'budget_reached'
                    ? 'The token budget of the last 24 hours is used up; new automatic investigations wait until it frees up.'
                    : llm.state === 'allowance_reached'
                      ? 'OpenAI itself says this key has too few requests left for a debate (or asked for a wait). Nothing is sent until it frees up; the numbers are below.'
                      : 'The next flagged window starts a debate that OpenAI answers.'}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase text-on-surface-variant">Tokens, 24 h</div>
            <Metric metric={llm.tokens_24h} label="OpenAI tokens in 24 hours" />
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-surface-container-highest" aria-hidden="true">
              <div className={cn('h-full', llm.state === 'budget_reached' ? 'bg-error' : 'bg-outline')} style={{ width: `${usedRatio * 100}%` }} />
            </div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase text-on-surface-variant">Budget</div>
            <Metric metric={llm.token_limit} label="OpenAI token budget" />
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase text-on-surface-variant">Calls, 24 h</div>
            <Metric metric={llm.calls_24h} label="OpenAI calls in 24 hours" />
          </div>
        </div>

        <div className="flex flex-col gap-1.5 border-t border-outline-variant/40 pt-3">
          <span className="font-mono text-[10px] uppercase text-on-surface-variant">What OpenAI allows this key</span>
          <AllowanceRows allowance={llm.allowance} />
        </div>
      </Card>
    </section>
  );
}
