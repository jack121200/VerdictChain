import { shortId } from '../../lib/format';
import { Icon } from '../../ui/Icon';
import { Proof } from '../../ui/Proof';

/**
 * Shown when the debate ended in status 'error'. The sentence is the investigation's stored error_reason
 * (GET /investigations/{id}), the same words the audit trail holds as the investigation_failed entry. A case
 * that failed before reasons were stored says that, instead of guessing a cause.
 */
export function FailureBanner({ investigationId, reason }: { investigationId: string; reason: string | null }) {
  return (
    <section
      role="alert"
      className="flex flex-col gap-2 rounded-xl border border-error/40 bg-error-container/20 p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <Icon name="error" size={22} className="mt-0.5 text-error" />
        <div className="flex flex-col gap-1">
          <span className="font-headline text-sm font-bold uppercase tracking-wider text-error">
            This debate stopped before a verdict
          </span>
          <span className="text-caption text-on-surface" data-testid="failure-reason">
            {reason ?? 'No reason was recorded: this case failed before the system stored reasons.'}
          </span>
          <span className="text-caption text-on-surface-variant">
            No verdict was reached and nothing was contained. The rounds that did finish stay below. Run the
            scenario again once the cause is fixed.
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 font-mono text-[10px] text-on-surface-variant">
        <Proof
          source={`GET /investigations/${shortId(investigationId)} · audit action investigation_failed`}
          n={reason === null ? 0 : 1}
          asOf={null}
          label="Why the debate stopped"
          definition="error_reason is written by the debate engine when a debate ends in status error, and the same sentence is appended to the audit trail as an investigation_failed entry (detail.reason). A case that failed before reasons were stored has none."
          reason={reason === null ? 'no reason was stored for this case' : null}
        />
      </div>
    </section>
  );
}
