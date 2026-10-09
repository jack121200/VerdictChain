import { useState, type ReactNode } from 'react';
import {
  describeError,
  releaseContainment,
  submitFeedback,
} from '../../api/client';
import type {
  AuditTrailResponse,
  Citation,
  EvidenceBundleResponse,
  InvestigationCitations,
  InvestigationDetail,
  InvestigationSummary,
  Metric as MetricEnvelope,
} from '../../api/types';
import { buildRoute } from '../../app/router';
import { cn } from '../../lib/cn';
import { isVerifiedClaim } from '../../lib/derive/citations';
import { meanSupporterConfidence, verifyVerdictConfidence } from '../../lib/derive/verdict';
import { formatDuration, formatPercent, shortId } from '../../lib/format';
import { Button } from '../../ui/Button';
import { CopyHash } from '../../ui/CopyHash';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { Metric } from '../../ui/Metric';
import { Proof } from '../../ui/Proof';
import { Skeleton } from '../../ui/Skeleton';
import { pushToast } from '../../ui/toast-store';
import { attributionFromCitations, containmentLatency } from './derive';
import { STATUS_LABEL, VERDICT_LABEL, verdictIcon, verdictTone } from './labels';

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

const BADGE: Record<'error' | 'tertiary' | 'secondary' | 'primary' | 'neutral', string> = {
  error: 'bg-error-container/40 text-error border border-error/40',
  tertiary: 'bg-tertiary-container/20 text-tertiary border border-tertiary/40',
  secondary: 'bg-secondary-container/20 text-secondary border border-secondary/40',
  primary: 'bg-primary-container/20 text-primary border border-primary/40',
  neutral: 'bg-surface-container-high text-on-surface-variant border border-outline-variant/40',
};

/** CERT cases show the USB-evidence macro; network cases show the topology grid. Decorative only. */
function evidenceImage(dataset: string | null | undefined): string {
  return dataset && dataset.includes('CERT') ? '/assets/usb-chip-macro.jpg' : '/assets/topology-grid.jpg';
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[11px]">
      <span className="shrink-0 text-on-surface-variant">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

/** Inner evidence panel (the reference's darkest inner cards, mapped to the background token). */
function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-2 rounded-lg border border-outline-variant/40 bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] font-semibold uppercase text-outline">{title}</span>
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
        <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-outline-variant/40 bg-surface-container-low p-6 text-center text-on-surface-variant">
          <Icon name="travel_explore" size={20} className="mb-2 text-outline" />
          <p className="font-mono text-xs">
            Select an investigation dossier to inspect its evidence bundle, attribution and chain of custody.
          </p>
        </div>
      </div>
    );
  }

  const { id, detail, bundle, citations, audit, summary, loadedAt } = dossier;
  const verdictClass = detail.data?.verdict_class ?? summary?.verdict_class ?? null;
  const status = detail.data?.status ?? summary?.status ?? null;
  const dataset = detail.data?.dataset ?? summary?.dataset ?? null;
  const confidence = detail.data?.verdict_confidence ?? summary?.verdict_confidence ?? null;

  const attribution = citations.data ? attributionFromCitations(citations.data.citations) : null;
  const latency = audit.data ? containmentLatency(audit.data.entries) : null;
  const chainValid = audit.data?.chain.valid ?? null;
  // The image caption quotes a row the Watchdog verified, never a value an agent merely claimed.
  const topCitation: Citation | null = citations.data?.citations.find(isVerifiedClaim) ?? null;

  const tone = verdictTone(verdictClass);

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

  const canFeedback = verdictClass !== null && status !== 'investigating' && status !== 'error';

  return (
    <div className="sticky top-24 space-y-5 rounded-2xl border border-outline-variant/50 bg-surface-container-low p-5 shadow-2xl backdrop-blur-xl">
      {/* Header info */}
      <div className="flex items-start justify-between gap-3 border-b border-outline-variant/40 pb-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <CopyHash value={id} label="Investigation id" />
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px]',
                chainValid === false
                  ? 'bg-error-container/40 text-error'
                  : 'bg-primary/10 text-primary',
              )}
            >
              <Icon name={chainValid === false ? 'warning' : 'verified_user'} size={12} />
              {chainValid === null ? 'Chain not verified' : chainValid ? 'Audit chain valid' : 'Chain broken'}
              <Proof
                source="GET /audit-trail.chain.valid"
                n={audit.data?.chain.total ?? 0}
                asOf={loadedAt}
                definition="Global hash-chain validity reported with the audit trail. This is a chain-wide tamper-evidence check (SHA-256 hash chain), not a per-case cryptographic inclusion proof."
                label="Audit chain validity"
              />
            </span>
          </div>
          <h2 className="font-headline text-xl font-bold text-on-surface">
            {detail.data?.trigger_type ?? summary?.trigger_type ?? 'Investigation'}
          </h2>
          <p className="font-mono text-[11px] text-on-surface-variant">
            {verdictClass === null ? (
              'No verdict yet'
            ) : (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-bold uppercase tracking-wider',
                  BADGE[tone],
                )}
              >
                <Icon name={verdictIcon(verdictClass)} size={12} />
                {VERDICT_LABEL[verdictClass]}
              </span>
            )}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <Metric
            size="kpi"
            className="justify-end text-primary"
            label="Agent-reported verdict confidence"
            metric={confidenceEnvelope(confidence, supporters?.n ?? 0, loadedAt)}
            format={(value) => formatPercent(value, 1)}
            proofInputs={[
              { label: 'supporters (n)', value: String(supporters?.n ?? 0) },
              { label: 'browser recompute', value: confidenceCheck },
            ]}
          />
          <span className="block font-mono text-[9px] uppercase text-on-surface-variant">Agent-reported conf.</span>
          {confidenceCheck === 'match' && (
            <span className="mt-1 inline-flex items-center gap-1 font-mono text-[9px] uppercase text-secondary">
              <Icon name="check" size={12} /> recompute matches
            </span>
          )}
          {confidenceCheck === 'mismatch' && (
            <span className="mt-1 inline-flex items-center gap-1 font-mono text-[9px] uppercase text-error">
              <Icon name="warning" size={12} /> recompute mismatch
            </span>
          )}
        </div>
      </div>

      {/* Technical forensics data */}
      <div className="space-y-3 font-mono text-xs">
        <Panel title="Cryptographic fingerprint & provenance">
          {bundle.data ? (
            <Row label="SHA-256 digest">
              <CopyHash value={bundle.data.bundle_sha256} label="Evidence bundle SHA-256" />
            </Row>
          ) : bundle.error ? (
            <Row label="SHA-256 digest">
              <span className="text-on-surface-variant">— {bundle.error}</span>
            </Row>
          ) : (
            <Skeleton className="h-4 w-48" />
          )}
          <Row label="Attributed subject">
            {attribution?.subject ? (
              <span className="text-on-surface">{attribution.subject.value}</span>
            ) : (
              <span className="text-on-surface-variant">— no user field cited</span>
            )}
          </Row>
          <Row label="Trigger event">
            <span className="text-tertiary">{detail.data?.trigger_type ?? summary?.trigger_type ?? '—'}</span>
          </Row>
          <Row label="Dataset shard">
            <span className="text-on-surface">{dataset ?? '—'}</span>
          </Row>
          <Row label="Debate status">
            <span className="text-secondary">{status === null ? '—' : STATUS_LABEL[status]}</span>
          </Row>
          {citations.data && (
            <div className="flex justify-end pt-1">
              <Proof
                source={`GET /investigations/${shortId(id)}/citations · /evidence-bundle`}
                n={attribution?.citationCount ?? 0}
                asOf={loadedAt}
                definition="SHA-256 is the canonical evidence-bundle digest. Attributed subject = most-cited user_id across the case's VERIFIED citations; a tie is broken by the lexicographically smallest value. Trigger, dataset and status are stored investigation fields."
                inputs={[
                  { label: 'subject count', value: attribution?.subject ? String(attribution.subject.count) : '0' },
                  { label: 'host count', value: attribution?.host ? String(attribution.host.count) : '0' },
                  { label: 'earliest cited', value: attribution?.earliestCitedTimestamp ?? 'none' },
                ]}
                label="Fingerprint and provenance"
              />
            </div>
          )}
        </Panel>

        {/* Sandboxed containment status */}
        <Panel
          title="Automated containment action"
          action={
            detail.data && detail.data.actions.length > 0 ? (
              <span className="rounded bg-secondary-container/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-secondary">
                Sandboxed
              </span>
            ) : null
          }
        >
          {detail.data ? (
            detail.data.actions.length > 0 ? (
              <div className="space-y-2">
                <ul className="space-y-1.5">
                  {detail.data.actions.map((action) => (
                    <li key={action.id} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="min-w-0 font-body text-on-surface">
                        <span className="font-mono">{action.action_type}</span>
                        <span className="text-on-surface-variant"> → </span>
                        <span className="font-mono text-on-surface-variant">{action.target}</span>
                      </span>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase',
                          action.is_simulated
                            ? 'bg-secondary-container/20 text-secondary'
                            : 'bg-error-container/40 text-error',
                        )}
                      >
                        <Icon name={action.is_simulated ? 'check' : 'warning'} size={12} />
                        {action.is_simulated ? 'Simulated' : 'Not simulated'}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center gap-2 border-t border-outline-variant/40 pt-2 text-[11px] text-on-surface-variant">
                  <span>Sandbox applied within</span>
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
              <p className="text-[11px] text-on-surface-variant">No containment actions for this case.</p>
            )
          ) : detail.error ? (
            <p className="text-[11px] text-on-surface-variant">— {detail.error}</p>
          ) : (
            <Skeleton className="h-4 w-44" />
          )}
        </Panel>

        {/* Watchdog citation check */}
        {citations.data && (
          <Panel title="Watchdog citation check">
            <div className="flex items-center gap-2 text-[11px] text-on-surface-variant">
              <span className="font-mono text-on-surface">
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

        {/* Raw evidence asset — the caption is a real cited row, or removed when none exists */}
        <Panel title="Raw evidence asset link">
          <div className="relative h-28 overflow-hidden rounded-lg border border-outline-variant/50 bg-surface-card">
            <img
              src={evidenceImage(dataset)}
              alt="Decorative forensic evidence backdrop"
              className="h-full w-full object-cover opacity-80 transition-opacity hover:opacity-100"
            />
            {topCitation && (
              <div className="absolute bottom-2 left-2 rounded bg-surface-container-lowest/80 px-2 py-0.5 font-mono text-[10px] text-primary backdrop-blur">
                {shortId(topCitation.row_id)} · {topCitation.field}={topCitation.value ?? '∅'}
              </div>
            )}
          </div>
          <p className="font-mono text-[9px] text-outline">
            Image is decorative. The caption is a real cited row from this case (GET /citations); no physical-evidence
            claims are made.
          </p>
        </Panel>
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-2">
        <span className="flex items-center gap-1">
          <Button variant="secondary" size="sm" icon="receipt_long" onClick={download} disabled={!bundle.data} className="flex-1 uppercase">
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
            className="flex-1 uppercase"
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
        <span className="font-mono text-[10px] uppercase text-on-surface-variant">Analyst feedback</span>
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

      {!canFeedback && status !== 'contained' && (
        <EmptyState
          icon="info"
          title="Feedback locked"
          description="Analyst feedback opens once this case reaches a verdict."
        />
      )}
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
function latencyEnvelope(
  latency: { value: number | null; reason: string | null } | null,
  asOf: string | null,
): MetricEnvelope<number> {
  return {
    value: latency?.value ?? null,
    n: latency?.value === null || latency === null ? 0 : 1,
    as_of: asOf ?? new Date().toISOString(),
    source: 'browser: GET /audit-trail (verdict_reached → first self-healing action)',
    definition: 'Milliseconds between the verdict_reached audit entry and the first sandbox action entry for this case.',
    reason: latency?.reason ?? null,
  };
}
