import { useState, type ReactNode } from 'react';
import {
  describeError,
  emergencyContainment,
  getMe,
  getRawLogCounts,
  getRbacMatrix,
  getSettings,
  getSystemStatus,
  listUsers,
  releaseContainment,
  updateSettings,
  updateUserRole,
} from '../../api/client';
import type { Capability, Role, ServiceHealth, Settings } from '../../api/types';
import { useAsync } from '../../app/use-async';
import { buildRoute, type SimpleRouteName } from '../../app/router';
import { cn } from '../../lib/cn';
import { ROLE_LABEL } from '../../lib/labels';
import { formatDuration, formatNumber, formatTimestamp, shortId } from '../../lib/format';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icon-names';
import { Metric } from '../../ui/Metric';
import { Proof } from '../../ui/Proof';
import { Select } from '../../ui/Select';
import { Table, type TableColumn } from '../../ui/Table';
import { Toggle } from '../../ui/Toggle';
import { pushToast } from '../../ui/toast-store';

const ROLES: readonly Role[] = ['secops_lead', 'watchdog_supervisor', 'forensic_analyst', 'red_team_auditor'];

function CardTitle({ icon, iconClass = 'text-primary', children }: { icon: IconName; iconClass?: string; children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 font-headline text-lg font-bold text-on-surface">
      <Icon name={icon} size={20} className={iconClass} />
      <span>{children}</span>
    </h2>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 font-mono text-xs">
      <span className="text-on-surface-variant">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function ServiceRow({ label, health }: { label: string; health: ServiceHealth | undefined }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-outline-variant/30 bg-background p-2 font-mono text-xs">
      <span className="inline-flex items-center gap-2 text-on-surface-variant">
        <span
          className={cn('h-2 w-2 rounded-full', health === undefined ? 'bg-outline' : health.ok ? 'bg-secondary animate-pulse' : 'bg-error')}
          aria-hidden="true"
        />
        {label}
      </span>
      <Metric metric={health?.latency_ms} size="body" format={formatDuration} label={`${label} latency`} />
    </div>
  );
}

function initialsOf(username: string | undefined): string {
  if (!username) return '··';
  const parts = username.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : username.slice(0, 2);
  return letters.toUpperCase();
}

function IntakeControl({
  settings,
  canEdit,
  busy,
  onToggle,
}: {
  settings: Settings | undefined;
  canEdit: boolean;
  busy: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <div className="space-y-4 rounded-xl border border-outline-variant/40 bg-surface-container-low p-5">
      <CardTitle icon="admin_panel_settings">Autonomous intake control</CardTitle>
      <Toggle
        label="Pause new investigations"
        description="While on, POST /investigations/simulate is rejected with 423. Audited as settings_changed."
        checked={settings?.intake_paused ?? false}
        disabled={!canEdit || busy || !settings}
        onChange={onToggle}
      />
      {!canEdit ? <p className="font-body text-xs text-on-surface-variant">Changing this requires the edit_settings capability.</p> : null}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-outline-variant/40 bg-background p-3">
        <span className="inline-flex items-center gap-2 font-body text-xs text-on-surface-variant">
          Verdict-confidence threshold (read-only here)
          <Proof
            source="GET /settings.verdict_confidence_threshold"
            n={1}
            asOf={null}
            definition="Minimum mean supporter confidence for a verdict. Edited on the Trust & credibility screen, not here."
            label="Verdict threshold"
          />
        </span>
        <span className="font-mono text-sm text-primary">{settings ? formatNumber(settings.verdict_confidence_threshold, 2) : '—'}</span>
      </div>
    </div>
  );
}

function CapabilityMatrix() {
  const rbac = useAsync(getRbacMatrix);
  const matrix = rbac.data;
  const caps = matrix ? (Object.keys(matrix.capabilities) as Capability[]) : [];
  const roles = matrix ? matrix.roles : ROLES;

  return (
    <div className="space-y-4 rounded-xl border border-outline-variant/40 bg-surface-container-low p-5">
      <div className="flex items-center justify-between">
        <CardTitle icon="admin_panel_settings" iconClass="text-secondary">
          Capability privilege matrix
        </CardTitle>
        <Proof source="GET /rbac/matrix" n={caps.length} asOf={rbac.loadedAt} definition="Read-only map of each capability to the roles that hold it (backend/api/rbac.py)." label="Capability matrix" />
      </div>
      {rbac.error && !matrix ? (
        <EmptyState title="Could not load the capability matrix" description={rbac.error} icon="warning" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr className="border-b border-outline-variant/40 text-outline">
                <th className="pb-2">Capability</th>
                {roles.map((role) => (
                  <th key={role} className="pb-2 text-center">
                    {ROLE_LABEL[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/20 text-on-surface">
              {caps.map((cap) => (
                <tr key={cap}>
                  <td className="py-2.5">{cap}</td>
                  {roles.map((role) => (
                    <td key={role} className="text-center">
                      {matrix && matrix.capabilities[cap].includes(role) ? (
                        <Icon name="verified_user" size={12} className="text-secondary" label={`${role} has ${cap}`} />
                      ) : (
                        <span className="text-outline">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function UserManagement() {
  const users = useAsync(listUsers);
  const [busyId, setBusyId] = useState<string | null>(null);
  const rows = users.data ?? [];

  async function changeRole(userId: string, role: Role): Promise<void> {
    setBusyId(userId);
    try {
      await updateUserRole(userId, role);
      pushToast('Role updated.', { tone: 'secondary' });
      users.reload();
    } catch (cause) {
      pushToast(describeError(cause), { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  const columns: readonly TableColumn<(typeof rows)[number]>[] = [
    { key: 'username', header: 'Analyst', cell: (row) => row.username },
    { key: 'id', header: 'ID', cell: (row) => shortId(row.analyst_id), mono: true },
    {
      key: 'role',
      header: 'Role',
      cell: (row) => (
        <Select
          label={`Role for ${row.username}`}
          value={row.role}
          disabled={busyId === row.analyst_id}
          onChange={(role) => changeRole(row.analyst_id, role)}
          options={ROLES.map((role) => ({ value: role, label: ROLE_LABEL[role] }))}
        />
      ),
    },
  ];

  return (
    <div className="space-y-4 rounded-xl border border-outline-variant/40 bg-surface-container-low p-5">
      <div className="flex items-center justify-between">
        <CardTitle icon="admin_panel_settings">User management</CardTitle>
        <Proof source="GET /users · PUT /users/{id}/role" n={rows.length} asOf={users.loadedAt} definition="Analysts and their roles. Role changes are audited; the last secops_lead cannot be demoted (409)." label="User management" />
      </div>
      {users.error && !users.data ? (
        <EmptyState title="Could not load users" description={users.error} icon="warning" />
      ) : (
        <Table caption="Users and roles" columns={columns} rows={rows} rowKey={(row) => row.analyst_id} empty={<EmptyState title="No analysts found" icon="info" />} />
      )}
    </div>
  );
}

function EmergencyContainment() {
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
        setNote(`Containment ran: ${result.actions_taken.length} sandboxed action(s). Status ${result.status}.`);
        pushToast('Sandboxed containment recorded.', { tone: 'secondary' });
      } else {
        const result = await releaseContainment(target);
        setNote(`Released: ${result.released.length} action(s) reverted. Status ${result.status}.`);
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
        className="w-full rounded-lg border border-outline-variant/60 bg-surface-container-low px-3 py-2 font-mono text-xs text-on-surface placeholder:text-on-surface-variant focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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

const QUICK_LINKS: ReadonlyArray<{ name: Exclude<SimpleRouteName, 'login'>; label: string; icon: IconName; tone: string }> = [
  { name: 'dashboard', label: 'Forensics HUD', icon: 'dashboard', tone: 'text-primary' },
  { name: 'investigations', label: 'Dossier archive', icon: 'travel_explore', tone: 'text-tertiary' },
  { name: 'fleet', label: 'Agent fleet', icon: 'hub', tone: 'text-primary-fixed' },
  { name: 'audit', label: 'Audit trail', icon: 'receipt_long', tone: 'text-secondary' },
];

export default function AccessPage() {
  const me = useAsync(getMe);
  const status = useAsync(getSystemStatus, 30_000);
  const settings = useAsync(getSettings, 30_000);
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
              id <code className="text-on-surface">{me.data ? shortId(me.data.analyst_id) : '—'}</code> • session expires{' '}
              <code className="text-on-surface">{me.data ? formatTimestamp(me.data.token_expires_at) : '—'}</code>
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
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded border border-outline-variant/40 bg-background p-2.5">
                    <span className="font-mono text-[10px] uppercase text-outline">Groq</span>
                    <p className="font-mono text-xs text-on-surface">{providers?.groq.configured ? (providers.groq.model ?? 'configured') : 'not configured'}</p>
                    <Field label="Temp">
                      <Metric metric={providers?.groq.temperature} size="body" label="Groq temperature" />
                    </Field>
                  </div>
                  <div className="rounded border border-outline-variant/40 bg-background p-2.5">
                    <span className="font-mono text-[10px] uppercase text-outline">Gemini</span>
                    <p className="font-mono text-xs text-on-surface">{providers?.gemini.configured ? (providers.gemini.model ?? 'configured') : 'not configured'}</p>
                    <Field label="Temp">
                      <Metric metric={providers?.gemini.temperature} size="body" label="Gemini temperature" />
                    </Field>
                  </div>
                </div>
                <Field label="Sandbox violations">
                  <Metric metric={status.data?.sandbox.is_simulated_violations} size="body" label="Sandbox violations" />
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
              <Proof source="GET /raw-logs/counts" n={rawCounts.data?.length ?? 0} asOf={rawCounts.loadedAt} definition="Ingested raw_logs row count per source." label="Data sources" />
            </div>
            {rawCounts.error && !rawCounts.data ? (
              <EmptyState title="Counts unavailable" description={rawCounts.error} icon="warning" />
            ) : (rawCounts.data ?? []).length === 0 ? (
              <EmptyState title="No ingested sources yet" icon="info" />
            ) : (
              (rawCounts.data ?? []).map((row) => (
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
