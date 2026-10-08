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
import { ROLE_LABEL } from '../../lib/labels';
import { formatDuration, formatNumber, formatTimestamp, shortId } from '../../lib/format';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icon-names';
import { Metric } from '../../ui/Metric';
import { Pill } from '../../ui/Pill';
import { Proof } from '../../ui/Proof';
import { Select } from '../../ui/Select';
import { StatusDot } from '../../ui/StatusDot';
import { Table, type TableColumn } from '../../ui/Table';
import { Toggle } from '../../ui/Toggle';
import { pushToast } from '../../ui/toast-store';

const ROLES: readonly Role[] = ['secops_lead', 'watchdog_supervisor', 'forensic_analyst', 'red_team_auditor'];

function CardTitle({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 font-headline text-h2 text-on-surface">
      <Icon name={icon} size={20} className="text-primary" />
      {children}
    </h2>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-caption text-on-surface-variant">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function ServiceRow({ label, health }: { label: string; health: ServiceHealth | undefined }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-outline-variant/40 bg-background p-2.5">
      <span className="inline-flex items-center gap-2 text-caption text-on-surface-variant">
        <StatusDot tone={health === undefined ? 'idle' : health.ok ? 'ok' : 'error'} label={`${label} health`} />
        {label}
      </span>
      <Metric metric={health?.latency_ms} size="body" format={formatDuration} label={`${label} latency`} />
    </div>
  );
}

function IntakeControl({ settings, canEdit, onChanged }: { settings: Settings | undefined; canEdit: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  async function toggle(next: boolean): Promise<void> {
    if (!settings) return;
    setBusy(true);
    try {
      await updateSettings({
        eta: settings.eta,
        isolation_threshold: settings.isolation_threshold,
        verdict_confidence_threshold: settings.verdict_confidence_threshold,
        intake_paused: next,
      });
      pushToast(next ? 'New investigations paused.' : 'Investigation intake resumed.', { tone: next ? 'tertiary' : 'secondary' });
      onChanged();
    } catch (cause) {
      pushToast(describeError(cause), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="space-y-4">
      <CardTitle icon="admin_panel_settings">Intake control</CardTitle>
      <Toggle
        label="Pause new investigations"
        description="While on, POST /investigations/simulate is rejected with 423. Audited as settings_changed."
        checked={settings?.intake_paused ?? false}
        disabled={!canEdit || busy || !settings}
        onChange={toggle}
      />
      {!canEdit ? <p className="text-caption text-on-surface-variant">Changing this requires the edit_settings capability.</p> : null}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-outline-variant/40 bg-background p-3">
        <span className="inline-flex items-center gap-2 text-caption text-on-surface-variant">
          Verdict-confidence threshold (read-only here)
          <Proof
            source="GET /settings.verdict_confidence_threshold"
            n={1}
            asOf={null}
            definition="Minimum mean supporter confidence for a verdict. Edited on the Trust & credibility screen, not here."
            label="Verdict threshold"
          />
        </span>
        <span className="font-mono text-evidence text-primary">{settings ? formatNumber(settings.verdict_confidence_threshold, 2) : '—'}</span>
      </div>
    </Card>
  );
}

function CapabilityMatrix() {
  const rbac = useAsync(getRbacMatrix);
  if (rbac.error && !rbac.data) {
    return (
      <Card className="space-y-4">
        <CardTitle icon="admin_panel_settings">Capability matrix</CardTitle>
        <EmptyState title="Could not load the capability matrix" description={rbac.error} icon="warning" />
      </Card>
    );
  }
  const matrix = rbac.data;
  const caps = matrix ? (Object.keys(matrix.capabilities) as Capability[]) : [];
  const roles = matrix ? matrix.roles : ROLES;
  const columns: readonly TableColumn<Capability>[] = [
    { key: 'cap', header: 'Capability', cell: (cap) => cap, mono: true },
    ...roles.map((role) => ({
      key: role,
      header: ROLE_LABEL[role],
      align: 'right' as const,
      cell: (cap: Capability) =>
        matrix && matrix.capabilities[cap].includes(role) ? (
          <Icon name="verified_user" size={12} className="text-secondary" label={`${role} has ${cap}`} />
        ) : (
          <span className="text-on-surface-variant">—</span>
        ),
    })),
  ];
  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <CardTitle icon="admin_panel_settings">Capability matrix</CardTitle>
        <Proof source="GET /rbac/matrix" n={caps.length} asOf={rbac.loadedAt} definition="Read-only map of each capability to the roles that hold it (backend/api/rbac.py)." label="Capability matrix" />
      </div>
      <Table caption="Capability matrix" columns={columns} rows={caps} rowKey={(cap) => cap} empty={<EmptyState title="No capabilities reported" icon="info" />} />
    </Card>
  );
}

function UserManagement() {
  const users = useAsync(listUsers);
  const [busyId, setBusyId] = useState<string | null>(null);

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
  const rows = users.data ?? [];

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <CardTitle icon="admin_panel_settings">User management</CardTitle>
        <Proof source="GET /users · PUT /users/{id}/role" n={rows.length} asOf={users.loadedAt} definition="Analysts and their roles. Role changes are audited; the last secops_lead cannot be demoted (409)." label="User management" />
      </div>
      {users.error && !users.data ? (
        <EmptyState title="Could not load users" description={users.error} icon="warning" />
      ) : (
        <Table caption="Users and roles" columns={columns} rows={rows} rowKey={(row) => row.analyst_id} empty={<EmptyState title="No analysts found" icon="info" />} />
      )}
    </Card>
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
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <CardTitle icon="warning">Emergency containment</CardTitle>
        <Proof
          source="POST /investigations/{id}/emergency-containment · /release-containment"
          n={1}
          asOf={null}
          definition="Re-derives the containment plan from the round-3 transcripts (no LLM) and runs it in the sandbox (is_simulated stays true). Release reverts it. Both are audited."
          label="Emergency containment"
        />
      </div>
      <p className="text-caption text-on-surface-variant">Per-investigation, sandbox-only. Enter an investigation id to run or release containment.</p>
      <input
        type="text"
        value={id}
        onChange={(event) => setId(event.target.value)}
        placeholder="Investigation id"
        aria-label="Investigation id"
        className="w-full rounded-lg border border-outline-variant/60 bg-surface-container-low px-3 py-2 font-mono text-evidence text-on-surface placeholder:text-on-surface-variant focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" icon="warning" busy={busy} onClick={() => act('run')}>
          Run sandboxed containment
        </Button>
        <Button variant="secondary" icon="sync_alt" busy={busy} onClick={() => act('release')}>
          Release
        </Button>
      </div>
      {note ? <p className="rounded-lg border border-outline-variant/40 bg-background p-2.5 font-mono text-evidence text-on-surface">{note}</p> : null}
    </Card>
  );
}

const QUICK_LINKS: ReadonlyArray<{ name: Exclude<SimpleRouteName, 'login'>; label: string; icon: IconName }> = [
  { name: 'dashboard', label: 'Forensics dashboard', icon: 'dashboard' },
  { name: 'investigations', label: 'Investigations', icon: 'travel_explore' },
  { name: 'fleet', label: 'Agent fleet', icon: 'hub' },
  { name: 'audit', label: 'Audit trail', icon: 'receipt_long' },
];

export default function AccessPage() {
  const me = useAsync(getMe);
  const status = useAsync(getSystemStatus, 30_000);
  const settings = useAsync(getSettings, 30_000);
  const rawCounts = useAsync(getRawLogCounts, 30_000);

  const capabilities = me.data?.capabilities ?? [];
  const canEditSettings = capabilities.includes('edit_settings');
  const canManageUsers = capabilities.includes('manage_users');
  const canContain = capabilities.includes('trigger_emergency_containment');
  const providers = status.data?.providers;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-6">
      <header className="flex flex-col gap-4 border-b border-outline-variant/40 pb-6">
        <div className="flex flex-col gap-2">
          <span className="inline-flex items-center gap-2 text-label uppercase text-primary">
            <StatusDot tone="live" /> Role-based access · service health
          </span>
          <h1 className="font-headline text-h1 tracking-tight text-on-surface sm:text-h1-sm">
            Access &amp; <span className="text-primary">system</span>
          </h1>
          <p className="max-w-2xl text-body text-on-surface-variant">
            Your identity and capabilities, the RBAC matrix, user administration, live service health and audited containment controls. Every control is gated by your real capabilities.
          </p>
        </div>

        <Card variant="panel" className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-primary bg-primary/10 text-primary">
              <Icon name="admin_panel_settings" size={20} />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-headline text-h3 text-on-surface">{me.data?.username ?? (me.error ?? 'Loading…')}</span>
                {me.data ? <Pill tone="primary">{ROLE_LABEL[me.data.role]}</Pill> : null}
              </div>
              <p className="mt-0.5 font-mono text-evidence text-on-surface-variant">
                id {me.data ? shortId(me.data.analyst_id) : '—'} · session expires {me.data ? formatTimestamp(me.data.token_expires_at) : '—'}
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
        </Card>
      </header>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-7">
          <IntakeControl settings={settings.data} canEdit={canEditSettings} onChanged={settings.reload} />
          <CapabilityMatrix />
          {canManageUsers ? <UserManagement /> : null}
        </div>

        <div className="space-y-4 lg:col-span-5">
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <CardTitle icon="check">Service health</CardTitle>
              <Proof
                source="GET /system/status"
                n={1}
                asOf={status.loadedAt}
                definition="Live probes of PostgreSQL, Redis and RabbitMQ (ok + latency), configured providers and the sandbox, run concurrently on the server."
                label="Service health"
              />
            </div>
            {status.error && !status.data ? (
              <EmptyState title="Status unavailable" description={status.error} icon="warning" />
            ) : (
              <>
                <ServiceRow label="PostgreSQL" health={status.data?.postgres} />
                <ServiceRow label="Redis" health={status.data?.redis} />
                <ServiceRow label="RabbitMQ" health={status.data?.rabbitmq} />
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-outline-variant/40 bg-background p-2.5">
                    <span className="text-label uppercase text-on-surface-variant">Groq</span>
                    <p className="font-mono text-evidence text-on-surface">{providers?.groq.configured ? (providers.groq.model ?? 'configured') : 'not configured'}</p>
                    <Field label="Temp">
                      <Metric metric={providers?.groq.temperature} size="body" label="Groq temperature" />
                    </Field>
                  </div>
                  <div className="rounded-lg border border-outline-variant/40 bg-background p-2.5">
                    <span className="text-label uppercase text-on-surface-variant">Gemini</span>
                    <p className="font-mono text-evidence text-on-surface">{providers?.gemini.configured ? (providers.gemini.model ?? 'configured') : 'not configured'}</p>
                    <Field label="Temp">
                      <Metric metric={providers?.gemini.temperature} size="body" label="Gemini temperature" />
                    </Field>
                  </div>
                </div>
                <Field label="Sandbox violations">
                  <Metric metric={status.data?.sandbox.is_simulated_violations} size="body" label="Sandbox violations" />
                </Field>
                <Field label="Migration head">
                  <span className="font-mono text-evidence text-on-surface">{status.data?.migration_head ?? '—'}</span>
                </Field>
              </>
            )}
          </Card>

          {canContain ? <EmergencyContainment /> : null}

          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <CardTitle icon="receipt_long">Data sources</CardTitle>
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
          </Card>

          <Card className="space-y-3">
            <CardTitle icon="dashboard">Quick links</CardTitle>
            <div className="grid grid-cols-2 gap-2">
              {QUICK_LINKS.map((link) => (
                <a
                  key={link.name}
                  href={buildRoute({ name: link.name })}
                  className="flex items-center gap-2 rounded-lg border border-outline-variant/40 bg-background p-3 text-body text-on-surface transition-colors hover:border-primary/50 hover:text-primary"
                >
                  <Icon name={link.icon} size={16} />
                  {link.label}
                </a>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
