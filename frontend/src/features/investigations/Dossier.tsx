import { useState, type ReactNode } from 'react';
import {
  describeError,
  releaseContainment,
  submitFeedback,
} from '../../api/client';
import type {
  AuditTrailResponse,
  EvidenceBundleResponse,
  InvestigationCitations,
  InvestigationDetail,
  InvestigationSummary,
  Metric as MetricEnvelope,
} from '../../api/types';
import { buildRoute } from '../../app/router';
import { meanSupporterConfidence, verifyVerdictConfidence } from '../../lib/derive/verdict';
import { formatDuration, formatPercent, formatTimestamp, shortId } from '../../lib/format';
import { Button } from '../../ui/Button';
import { CopyHash } from '../../ui/CopyHash';
import { EmptyState } from '../../ui/EmptyState';
import { Metric } from '../../ui/Metric';
import { Pill } from '../../ui/Pill';
import { Proof } from '../../ui/Proof';
import { Skeleton } from '../../ui/Skeleton';
import { pushToast } from '../../ui/toast-store';
import { attributionFromCitations, containmentLatency } from './derive';
import { STATUS_LABEL, VERDICT_LABEL, statusTone, verdictIcon, verdictTone } from './labels';

/** The last successful value for one request, or a plain-words error. */
export interface Loaded<T> {
  data?: T;
  error?: string;
}

export interface DossierData {
  id: string;
  summary?: InvestigationSummary;
  detail: Loaded<InvestigationDetail>;
  bundle: Loaded<EvidenceBundleResponse>;
  citations: Loaded<InvestigationCitations>;
  audit: Loaded<AuditTrailResponse>;
  loadedAt: string | null;
}

export interface DossierProps {
  dossier: DossierData | null;
  onChanged: () => void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-caption">
      <span className="shrink-0 text-on-surface-variant">{label}</span>
      <span className="min-w-0 text-right text-on-surface">{children}</span>
    </div>
  );
}

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-2 rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-label uppercase text-on-surface-variant">{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

/** Right-hand inspector for one investigation. Every value is an API field or a Proof-documented derivation. */
export function Dossier({ dossier, onChanged }: DossierProps) {
  const [feedbackBusy, setFeedbackBusy] = useState<null | 'confirm' | 'false_positive'>(null);
  const [releaseBusy, setReleaseBusy] = useState(false);

  if (dossier === null) {
    return (
      <div className="sticky top-24">
        <EmptyState
          icon="travel_explore"
          title="Select a dossier"
          description="Pick an investigation on the left to inspect its evidence bundle, attribution and chain of custody."
        />
      </div>
    );
  }

  const { id, detail, bundle, citations, audit, summary, loadedAt } = dossier;
  const verdictClass = detail.data?.verdict_class ?? summary?.verdict_class ?? null;
  const status = detail.data?.status ?? summary?.status ?? null;

  const attribution = citations.data ? attributionFromCitations(citations.data.citations) : null;
  const latency = audit.data ? containmentLatency(audit.data.entries) : null;

  const chainValid = audit.data?.chain.valid ?? null;

  function download() {
    if (!bundle.data) return;
    const payload = {
      evidence_bundle: bundle.data.bundle,
      bundle_sha256: bundle.data.bundle_sha256,
      audit_entries: audit.data?.entries ?? [],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${shortId(id)}.chain-of-custody.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    pushToast('Chain-of-custody JSON downloaded.', { tone: 'secondary' });
  }

  async function sendFeedback(correct: boolean) {
    setFeedbackBusy(correct ? 'confirm' : 'false_positive');
    try {
      await submitFeedback(id, correct);
      pushToast(correct ? 'Recorded: verdict confirmed.' : 'Recorded: marked false positive.', { tone: 'secondary' });
      onChanged();
    } catch (error) {
      pushToast(describeError(error), { tone: 'error' });
    } finally {
      setFeedbackBusy(null);
    }
  }

  async function release() {
    setReleaseBusy(true);
    try {
      await releaseContainment(id);
      pushToast('Containment released (audited, simulated).', { tone: 'secondary' });
      onChanged();
    } catch (error) {
      pushToast(describeError(error), { tone: 'error' });
    } finally {
      setReleaseBusy(false);
    }
  }

  const supporters = detail.data && verdictClass ? meanSupporterConfidence(detail.data.votes, verdictClass) : null;
  const confidenceCheck =
    detail.data && verdictClass
      ? verifyVerdictConfidence(detail.data.verdict_confidence, detail.data.votes, verdictClass)
      : 'not_checkable';

  const canFeedback = verdictClass !== null && status !== 'running' && status !== 'failed';

  return (
    <div className="sticky top-24 space-y-4 rounded-2xl border border-outline-variant/40 bg-surface-container-low p-5 shadow-2xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-outline-variant/40 pb-4">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <CopyHash value={id} label="Investigation id" />
            <Pill
              tone={chainValid === true ? 'secondary' : chainValid === false ? 'error' : 'neutral'}
              icon={chainValid === true ? 'verified_user' : chainValid === false ? 'warning' : 'info'}
            >
              {chainValid === null ? 'Chain not verified' : chainValid ? 'Audit chain valid (global)' : 'Chain broken'}
            </Pill>
            <Proof
              source="GET /audit-trail.chain.valid"
              n={audit.data?.chain.total ?? 0}
              asOf={loadedAt}
              definition="Global hash-chain validity reported with the audit trail. This is a chain-wide check, not a per-case cryptographic inclusion proof."
              label="Audit chain validity"
            />
          </div>
          {verdictClass !== null ? (
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={verdictTone(verdictClass)} icon={verdictIcon(verdictClass)}>
                {VERDICT_LABEL[verdictClass]}
              </Pill>
              <span className="font-mono text-evidence text-on-surface-variant">{verdictClass}</span>
            </div>
          ) : (
            <span className="text-caption text-on-surface-variant">No verdict yet</span>
          )}
        </div>
        {status !== null && (
          <Pill tone={statusTone(status)}>{STATUS_LABEL[status]}</Pill>
        )}
      </div>

      {/* Cryptographic fingerprint */}
      <Panel title="Evidence bundle fingerprint">
        {bundle.data ? (
          <div className="space-y-1.5">
            <Field label="SHA-256">
              <CopyHash value={bundle.data.bundle_sha256} label="Evidence bundle SHA-256" />
            </Field>
            <Proof
              source={`GET /investigations/${shortId(id)}/evidence-bundle.bundle_sha256`}
              n={1}
              asOf={loadedAt}
              definition="SHA-256 of the canonical evidence bundle (sorted keys, compact separators). The browser can recompute it over the downloaded JSON."
              label="Evidence bundle SHA-256"
            />
          </div>
        ) : bundle.error ? (
          <p className="text-caption text-on-surface-variant">— {bundle.error}</p>
        ) : (
          <Skeleton className="h-4 w-48" />
        )}
      </Panel>

      {/* Attribution derived from cited rows */}
      <Panel title="Attribution (derived from cited rows)">
        {citations.data ? (
          <div className="space-y-1.5">
            <Field label="Attributed subject">
              {attribution?.subject ? (
                <span className="font-mono text-evidence">{attribution.subject.value}</span>
              ) : (
                <span className="text-on-surface-variant">— no user field cited</span>
              )}
            </Field>
            <Field label="Attributed host">
              {attribution?.host ? (
                <span className="font-mono text-evidence">{attribution.host.value}</span>
              ) : (
                <span className="text-on-surface-variant">— no host field cited</span>
              )}
            </Field>
            <Field label="Trigger type">
              <span className="font-mono text-evidence">{detail.data?.trigger_type ?? summary?.trigger_type ?? '—'}</span>
            </Field>
            {detail.data?.trigger_reason && (
              <Field label="Trigger reason">
                <span className="text-on-surface">{detail.data.trigger_reason}</span>
              </Field>
            )}
            {attribution?.earliestCitedTimestamp && (
              <Field label="Earliest cited time">
                <span className="font-mono text-evidence">{formatTimestamp(attribution.earliestCitedTimestamp)}</span>
              </Field>
            )}
            <Proof
              source={`GET /investigations/${shortId(id)}/citations`}
              n={attribution?.citationCount ?? 0}
              asOf={loadedAt}
              definition="Subject = most-cited user_id across the case's citations; host = most-cited host_id; earliest cited timestamp from cited time fields. Trigger type and reason are stored investigation fields."
              inputs={[
                { label: 'subject count', value: attribution?.subject ? String(attribution.subject.count) : '0' },
                { label: 'host count', value: attribution?.host ? String(attribution.host.count) : '0' },
              ]}
              label="Attribution"
            />
          </div>
        ) : citations.error ? (
          <p className="text-caption text-on-surface-variant">— {citations.error}</p>
        ) : (
          <Skeleton className="h-4 w-40" />
        )}
      </Panel>

      {/* Verdict confidence (agent-reported) */}
      {verdictClass !== null && (
        <Panel title="Verdict confidence (agent-reported)">
          <div className="flex items-center justify-between gap-2">
            <Metric
              size="body"
              label="Verdict confidence"
              metric={confidenceEnvelope(detail.data?.verdict_confidence ?? null, supporters?.n ?? 0, loadedAt)}
              format={(value) => formatPercent(value, 1)}
              proofInputs={[
                { label: 'supporters (n)', value: String(supporters?.n ?? 0) },
                { label: 'browser recompute', value: confidenceCheck },
              ]}
            />
            {confidenceCheck === 'match' && (
              <Pill tone="secondary" icon="check">
                Recompute matches
              </Pill>
            )}
            {confidenceCheck === 'mismatch' && (
              <Pill tone="error" icon="warning">
                Recompute mismatch
              </Pill>
            )}
          </div>
        </Panel>
      )}

      {/* Containment */}
      <Panel title="Containment (sandboxed)">
        {detail.data ? (
          detail.data.actions.length > 0 ? (
            <div className="space-y-2">
              <ul className="space-y-1.5">
                {detail.data.actions.map((action) => (
                  <li key={action.id} className="flex items-center justify-between gap-2 text-caption">
                    <span className="min-w-0">
                      <span className="font-mono text-evidence text-on-surface">{action.action_type}</span>
                      <span className="text-on-surface-variant"> → </span>
                      <span className="font-mono text-evidence text-on-surface-variant">{action.target}</span>
                    </span>
                    <Pill tone={action.is_simulated ? 'secondary' : 'error'} icon={action.is_simulated ? 'check' : 'warning'}>
                      {action.is_simulated ? 'Simulated' : 'Not simulated'}
                    </Pill>
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-2 border-t border-outline-variant/40 pt-2">
                <span className="text-caption text-on-surface-variant">Sandbox applied within</span>
                <Metric
                  size="body"
                  label="Verdict to first action latency"
                  metric={latencyEnvelope(latency, loadedAt)}
                  format={(ms) => formatDuration(ms)}
                  proofInputs={[
                    { label: 'verdict at', value: latency?.verdictAt ?? 'not recorded' },
                    { label: 'first action at', value: latency?.firstActionAt ?? 'not recorded' },
                    { label: 'first action', value: latency?.firstAction ?? 'none' },
                  ]}
                />
              </div>
            </div>
          ) : (
            <p className="text-caption text-on-surface-variant">No containment actions for this case.</p>
          )
        ) : detail.error ? (
          <p className="text-caption text-on-surface-variant">— {detail.error}</p>
        ) : (
          <Skeleton className="h-4 w-44" />
        )}
      </Panel>

      {/* Citation summary */}
      {citations.data && (
        <Panel title="Watchdog citation check">
          <div className="flex items-center gap-2 text-caption text-on-surface-variant">
            <span className="font-mono text-evidence text-on-surface">
              {citations.data.summary.verified}/{citations.data.summary.total}
            </span>
            verified
            <Metric
              size="body"
              label="Citation match rate"
              metric={citations.data.summary.match_rate}
              format={(value) => formatPercent(value, 1)}
            />
          </div>
        </Panel>
      )}

      {/* Actions */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <span className="flex items-center gap-1">
          <Button variant="secondary" size="sm" icon="receipt_long" onClick={download} disabled={!bundle.data} className="flex-1">
            Chain-of-custody
          </Button>
          <Proof
            source="browser: evidence-bundle JSON + audit entries"
            n={1}
            asOf={loadedAt}
            definition="Downloads the evidence bundle, its SHA-256 and the case's audit entries as one JSON file. Nothing is sent to the server."
            label="Chain-of-custody download"
          />
        </span>
        <span className="flex items-center gap-1">
          <Button
            variant="primary"
            size="sm"
            icon="sync_alt"
            onClick={() => {
              window.location.hash = buildRoute({ name: 'debate', id });
            }}
            className="flex-1"
          >
            Open replay
          </Button>
          <Proof
            source={`#/debate/${shortId(id)}`}
            n={1}
            asOf={null}
            definition="Opens the debate room in replay mode for this investigation. Replay reads stored transcripts only and triggers no provider call."
            label="Open replay"
          />
        </span>
      </div>

      {/* Analyst feedback */}
      <div className="space-y-2 border-t border-outline-variant/40 pt-3">
        <span className="text-label uppercase text-on-surface-variant">Analyst feedback</span>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon="check_circle"
            busy={feedbackBusy === 'confirm'}
            disabled={!canFeedback || feedbackBusy !== null}
            onClick={() => sendFeedback(true)}
          >
            Confirm verdict
          </Button>
          <Button
            variant="danger"
            size="sm"
            icon="warning"
            busy={feedbackBusy === 'false_positive'}
            disabled={!canFeedback || feedbackBusy !== null}
            onClick={() => sendFeedback(false)}
          >
            False positive
          </Button>
          <Proof
            source={`POST /investigations/${shortId(id)}/feedback`}
            n={1}
            asOf={null}
            definition="Records the analyst's ground-truth judgement (audited). Feedback is what makes the Brier score and evaluation possible; it is not available while a case is still running."
            label="Analyst feedback"
          />
        </div>
        {status === 'contained' && (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" icon="sync_alt" busy={releaseBusy} disabled={releaseBusy} onClick={release}>
              Release containment
            </Button>
            <Proof
              source={`POST /investigations/${shortId(id)}/release-containment`}
              n={1}
              asOf={null}
              definition="Runs the inverse sandbox actions (audited). The actions are simulated; no real system is reachable."
              label="Release containment"
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** Builds a Metric envelope for the server verdict confidence (agent-reported mean of supporters). */
function confidenceEnvelope(value: number | null, n: number, asOf: string | null): MetricEnvelope<number> {
  return {
    value,
    n,
    as_of: asOf ?? new Date().toISOString(),
    source: 'GET /investigations/{id}.verdict_confidence',
    definition:
      'Server-aggregated mean of the supporting agents’ self-reported confidence. This is agent-reported confidence, not accuracy; accuracy comes only from /evaluation.',
    reason: value === null ? 'no verdict confidence recorded' : null,
  };
}

/** Builds a Metric envelope for the measured verdict-to-first-action latency (n = 1). */
function latencyEnvelope(latency: { value: number | null; reason: string | null } | null, asOf: string | null): MetricEnvelope<number> {
  return {
    value: latency?.value ?? null,
    n: latency?.value === null || latency === null ? 0 : 1,
    as_of: asOf ?? new Date().toISOString(),
    source: 'browser: GET /audit-trail (verdict_reached → first self-healing action)',
    definition: 'Milliseconds between the verdict_reached audit entry and the first sandbox action entry for this case.',
    reason: latency?.reason ?? null,
  };
}
