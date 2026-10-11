import { useState } from 'react';
import { describeError, getMe, getRawLogCounts, getSettings, getSystemStatus, updateSettings } from '../../api/client';
import { useAsync } from '../../app/use-async';
import { buildRoute, type SimpleRouteName } from '../../app/router';
import { cn } from '../../lib/cn';
import { ROLE_LABEL } from '../../lib/labels';
import { formatDuration, shortId } from '../../lib/format';
import { CopyHash } from '../../ui/CopyHash';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icon-names';
import { AllowanceRows } from '../../ui/AllowanceRows';
import { Metric } from '../../ui/Metric';
import { Proof } from '../../ui/Proof';
import { Timestamp } from '../../ui/Timestamp';
import { pushToast } from '../../ui/toast-store';
import { CardTitle, Field, ServiceRow, initialsOf } from './shared';
import { IntakeControl } from './IntakeControl';
import { CapabilityMatrix, UserManagement } from './Roles';
import { EmergencyContainment } from './EmergencyContainment';

const QUICK_LINKS: ReadonlyArray<{ name: Exclude<SimpleRouteName, 'login'>; label: string; icon: IconName; tone: string }> = [
  { name: 'dashboard', label: 'Forensics HUD', icon: 'dashboard', tone: 'text-primary' },
  { name: 'investigations', label: 'Dossier archive', icon: 'travel_explore', tone: 'text-tertiary' },
  { name: 'fleet', label: 'Agent fleet', icon: 'hub', tone: 'text-primary-fixed' },
  { name: 'audit', label: 'Audit trail', icon: 'receipt_long', tone: 'text-secondary' },
];

export default function AccessPage() {
  const me = useAsync(getMe);
  const status = useAsync(getSystemStatus, 30_000, ['investigations', 'agents', 'settings', 'actions']);
  const settings = useAsync(getSettings, 30_000, ['settings']);
  const rawCounts = useAsync(getRawLogCounts, 30_000);
  const [pauseBusy, setPauseBusy] = useState(false);

  const capabilities = me.data?.capabilities ?? [];
  const canEditSettings = capabilities.includes('edit_settings');
  const canManageUsers = capabilities.includes('manage_users');
  const canContain = capabilities.includes('trigger_emergency_containment');
  const providers = status.data?.providers;
  const paused = settings.data?.intake_paused ?? false;

  async function setPaused(next: boolean): Promise<void> {
    const current = settings.data;
    if (!current) return;
    setPauseBusy(true);
    try {
      await updateSettings({
        eta: current.eta,
        isolation_threshold: current.isolation_threshold,
        verdict_confidence_threshold: current.verdict_confidence_threshold,
        intake_paused: next,
      });
      pushToast(next ? 'New investigations paused.' : 'Investigation intake resumed.', { tone: next ? 'tertiary' : 'secondary' });
      settings.reload();
    } catch (cause) {
      pushToast(describeError(cause), { tone: 'error' });
    } finally {
      setPauseBusy(false);
    }
  }

  return (
    <section className="relative mx-auto min-h-screen w-full max-w-7xl px-4 py-6 lg:px-6">
      {/* Screen header */}
      <div className="flex flex-col justify-between gap-4 border-b border-outline-variant/40 pb-6 md:flex-row md:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-primary">
            <span className="h-2 w-2 rounded-full bg-primary animate-pulse" aria-hidden="true" />
            <span>Role-based forensic access • service health</span>
          </div>
          <h1 className="font-headline text-3xl font-bold tracking-tight text-on-surface sm:text-4xl">
            Access &amp; policy <span className="text-primary">console</span>
          </h1>
          <p className="mt-1 max-w-2xl font-body text-sm text-on-surface-variant">
            Your identity and capabilities, the RBAC matrix, user administration, live service health and audited containment controls. Every control is gated by your real capabilities.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={() => setPaused(!paused)}
            disabled={!canEditSettings || !settings.data || pauseBusy}
            className={cn(
              'flex items-center gap-2 rounded px-4 py-2 font-mono text-xs font-bold uppercase shadow-glow-crimson transition-all disabled:cursor-not-allowed disabled:opacity-50',
              paused
                ? 'bg-error-strong text-on-error-container animate-pulse'
                : 'border border-error/50 bg-error-container/40 text-error hover:bg-error-strong hover:text-on-error-container',
            )}
          >
            <Icon name="warning" size={20} />
            <span>{paused ? 'Intake paused (resume)' : 'Pause new investigations'}</span>
          </button>
        </div>
      </div>

      {/* Identity banner */}
      <div className="mt-6 flex flex-col justify-between gap-4 rounded-2xl border border-outline-variant/40 bg-surface-container-low/80 p-5 backdrop-blur-md md:flex-row md:items-center">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl border-2 border-primary bg-primary/10 font-headline text-lg font-bold text-primary shadow-glow-cyan">
              {initialsOf(me.data?.username)}
            </div>
            <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-secondary ring-2 ring-background">
              <Icon name="check" size={12} className="text-on-secondary" />
            </span>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-headline text-lg font-bold text-on-surface">{me.data?.username ?? (me.error ?? 'Loading…')}</span>
              {me.data ? (
                <span className="rounded border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-primary">{ROLE_LABEL[me.data.role]}</span>
              ) : null}
            </div>
            <p className="mt-0.5 font-mono text-xs text-on-surface-variant">
              id{' '}
              {me.data ? (
                <CopyHash value={me.data.analyst_id} display={shortId(me.data.analyst_id)} label="analyst id" size="inherit" />
              ) : (
                <code className="text-on-surface">—</code>
              )}{' '}
              • session expires <Timestamp iso={me.data?.token_expires_at} future className="text-on-surface" />
            </p>
          </div>
        </div>
        <Proof
          source="GET /auth/me"
          n={1}
          asOf={me.loadedAt}
          definition="username, role, analyst_id, token_expires_at and capabilities for the signed-in analyst. The role is read from the database on every request."
          label="Identity"
        />
      </div>

      {/* Console sections */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: intake policy + privilege matrix */}
        <div className="space-y-4 lg:col-span-7">
          <IntakeControl settings={settings.data} canEdit={canEditSettings} busy={pauseBusy} onToggle={setPaused} />
          <CapabilityMatrix />
          {canManageUsers ? <UserManagement /> : null}
        </div>

        {/* Right: service health + containment + sources + quick links */}
        <div className="space-y-4 lg:col-span-5">
          <div className="space-y-3 rounded-xl border border-outline-variant/40 bg-surface-container-low p-5">
            <div className="flex items-center justify-between">
              <CardTitle icon="check" iconClass="text-secondary">
                Service health
              </CardTitle>
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-secondary animate-pulse" aria-hidden="true" />
                <Proof
                  source="GET /system/status"
                  n={1}
                  asOf={status.loadedAt}
                  definition="Live probes of PostgreSQL, Redis and RabbitMQ (ok + latency), configured providers and the sandbox, run concurrently on the server."
                  label="Service health"
                />
              </span>
            </div>
            {status.error && !status.data ? (
              <EmptyState title="Status unavailable" description={status.error} icon="warning" />
            ) : (
              <>
                <ServiceRow label="PostgreSQL" health={status.data?.postgres} />
                <ServiceRow label="Redis" health={status.data?.redis} />
                <ServiceRow label="RabbitMQ" health={status.data?.rabbitmq} />
                <div className="rounded border border-outline-variant/40 bg-background p-2.5">
                  <span className="font-mono text-[10px] uppercase text-outline">OpenAI · the only provider</span>
                  <p className="font-mono text-xs text-on-surface">{providers?.openai.configured ? (providers.openai.model ?? 'configured') : 'not configured'}</p>
                  <Field label="Temp">
                    <Metric metric={providers?.openai.temperature} size="body" label="OpenAI temperature" />
                  </Field>
                  <Field label="Call time">
                    <Metric metric={providers?.openai.latency_ms} size="body" label="OpenAI call time" format={formatDuration} />
                  </Field>
                  <Field label="Calls 24 h">
                    <Metric metric={providers?.openai.calls_24h} size="body" label="OpenAI calls in 24 hours" />
                  </Field>
                  <Field label="Quota errors 24 h">
                    <Metric metric={providers?.openai.quota_errors_24h} size="body" label="OpenAI quota errors in 24 hours" />
                  </Field>
                  <div className="mt-2 border-t border-outline-variant/40 pt-2">
                    <span className="font-mono text-[10px] uppercase text-outline">What OpenAI allows this key</span>
                    <AllowanceRows allowance={providers?.openai.allowance} />
                  </div>
                  <p className="mt-1 text-caption text-on-surface-variant">
                    Every debate and every action reason is answered by this model. Token use against the daily budget is on the Live feed page.
                  </p>
                </div>
                <Field label="Sandbox violations">
                  <Metric metric={status.data?.sandbox.is_simulated_violations} size="body" label="Sandbox violations" />
                </Field>
                <Field label="Continuous ingestion">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-on-surface">
                      {status.data === undefined ? '—' : status.data.continuous_mode ? 'on · simulated live feed' : 'off · manual injection only'}
                    </span>
                    <Proof
                      source="GET /system/status (continuous_mode)"
                      n={1}
                      asOf={status.loadedAt}
                      label="Continuous ingestion"
                      definition="Whether the simulated live feed is running: dataset rows are replayed into RabbitMQ on their own and a flagged window starts an investigation. When it is off, a debate starts only when an analyst injects a scenario. Start or stop it on the Live feed page."
                    />
                  </span>
                </Field>
                <Field label="Migration head">
                  <span className="text-on-surface">{status.data?.migration_head ?? '—'}</span>
                </Field>
              </>
            )}
          </div>

          {canContain ? <EmergencyContainment /> : null}

          <div className="space-y-3 rounded-xl border border-outline-variant/40 bg-surface-container-low p-5">
            <div className="flex items-center justify-between">
              <CardTitle icon="receipt_long" iconClass="text-tertiary">
                Data sources
              </CardTitle>
              <Proof source="GET /raw-logs/counts" n={rawCounts.data?.sources.length ?? 0} asOf={rawCounts.loadedAt} definition="Ingested raw_logs row count per source." label="Data sources" />
            </div>
            {rawCounts.error && !rawCounts.data ? (
              <EmptyState title="Counts unavailable" description={rawCounts.error} icon="warning" />
            ) : (rawCounts.data?.sources ?? []).length === 0 ? (
              <EmptyState title="No ingested sources yet" icon="info" />
            ) : (
              (rawCounts.data?.sources ?? []).map((row) => (
                <Field key={row.source} label={row.source}>
                  <Metric metric={row.count} size="body" label={`${row.source} rows`} />
                </Field>
              ))
            )}
          </div>

          <div className="space-y-3 rounded-xl border border-outline-variant/40 bg-surface-container-low p-5">
            <CardTitle icon="dashboard">Tactical quick links</CardTitle>
            <div className="grid grid-cols-2 gap-2">
              {QUICK_LINKS.map((link) => (
                <a
                  key={link.name}
                  href={buildRoute({ name: link.name })}
                  className="group rounded-lg border border-outline-variant/40 bg-background p-3 transition-colors hover:bg-surface-card"
                >
                  <Icon name={link.icon} size={20} className={cn('mb-1', link.tone)} />
                  <div className="font-headline text-xs font-semibold text-on-surface group-hover:text-primary">{link.label}</div>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
