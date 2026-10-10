import { getAdaptiveThreshold } from '../../api/client';
import type { AdaptiveThreshold as AdaptiveThresholdData } from '../../api/types';
import { useAsync } from '../../app/use-async';
import { formatNumber, formatPercent } from '../../lib/format';
import { Icon } from '../../ui/Icon';
import { Metric } from '../../ui/Metric';
import { Pill } from '../../ui/Pill';
import { Proof } from '../../ui/Proof';
import { Timestamp } from '../../ui/Timestamp';

const STEP_LABEL: Record<AdaptiveThresholdData['next_step'], string> = {
  tighten: 'Tighten',
  relax: 'Relax',
  hold: 'Hold',
  wait: 'Waiting for feedback',
};

/** Rule text built from the API's own constants, so it can never drift from the backend. */
function ruleText(rule: AdaptiveThresholdData['rule']): string {
  return (
    `Looks at the newest ${rule.window_size} analyst feedback rows and needs at least ${rule.min_feedback}. ` +
    `If ${formatPercent(rule.tighten_at, 0)} or more are false positives the floor goes up by ${formatNumber(rule.step_up, 2)}; ` +
    `if ${formatPercent(rule.relax_at, 0)} or fewer are, it goes down by ${formatNumber(rule.step_down, 2)}. ` +
    `It moves at most once per ${rule.adapt_every} new feedback rows and stays between ${formatNumber(rule.floor, 2)} and ${formatNumber(rule.ceiling, 2)}.`
  );
}

/**
 * Analyst feedback moves the verdict confidence floor by small, audited steps (GET /settings/adaptive).
 * Shown under the policy configurator so an analyst sees why the floor is where it is.
 */
export function AdaptiveThreshold() {
  const adaptive = useAsync(getAdaptiveThreshold, undefined, ['settings', 'stats']);
  const data = adaptive.data;
  return (
    <section className="space-y-3 rounded-xl border border-outline-variant/40 bg-surface-container-low p-5 shadow-md" aria-label="Adaptive verdict threshold">
      <div className="flex items-center gap-2">
        <Icon name="tune" size={20} className="text-primary" />
        <h2 className="font-headline text-base font-bold text-on-surface">Adaptive verdict floor</h2>
        {data && (
          <Proof
            source="GET /settings/adaptive"
            n={data.window.n}
            asOf={adaptive.loadedAt}
            label="Adaptive verdict floor"
            definition={ruleText(data.rule)}
          />
        )}
      </div>
      {adaptive.error !== null && data === undefined && <p className="text-caption text-error">{adaptive.error}</p>}
      {data && (
        <>
          <p className="font-body text-xs text-on-surface-variant">
            When analysts mark many verdicts as false positives, the confidence a verdict needs before containment rises a little; when they
            keep confirming, it eases a little. Every move is an audited settings change by <code className="font-mono text-on-surface">adaptive_feedback</code>.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-outline-variant/40 bg-background p-3">
              <div className="font-mono text-[10px] uppercase text-on-surface-variant">Floor now</div>
              <Metric metric={data.threshold} label="Verdict confidence floor" format={(value) => formatNumber(value, 2)} />
            </div>
            <div className="rounded-lg border border-outline-variant/40 bg-background p-3">
              <div className="font-mono text-[10px] uppercase text-on-surface-variant">Feedback rows looked at</div>
              <Metric metric={data.window} label="Feedback rows in the window" />
            </div>
            <div className="rounded-lg border border-outline-variant/40 bg-background p-3">
              <div className="font-mono text-[10px] uppercase text-on-surface-variant">False positives</div>
              <Metric metric={data.false_positive_share} label="False-positive share" format={(value) => formatPercent(value, 0)} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-caption text-on-surface-variant">
            <Pill tone={data.next_step === 'tighten' ? 'error' : data.next_step === 'relax' ? 'secondary' : 'neutral'}>
              {STEP_LABEL[data.next_step]}
            </Pill>
            <span>{data.reason}</span>
          </div>
          <div className="text-caption text-on-surface-variant">
            {data.last_change ? (
              <>
                Last move <Timestamp iso={data.last_change.at} />: {formatNumber(data.last_change.before, 2)} to{' '}
                {formatNumber(data.last_change.after, 2)}. {data.last_change.reason}
              </>
            ) : (
              'No move yet.'
            )}
          </div>
        </>
      )}
    </section>
  );
}
