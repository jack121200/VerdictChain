/** The capability matrix and the user management card. */
import { useState } from 'react';
import { describeError, getRbacMatrix, listUsers, updateUserRole } from '../../api/client';
import type { Capability, Role } from '../../api/types';
import { useAsync } from '../../app/use-async';
import { ROLE_LABEL } from '../../lib/labels';
import { shortId } from '../../lib/format';
import { CopyHash } from '../../ui/CopyHash';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { Proof } from '../../ui/Proof';
import { Select } from '../../ui/Select';
import { Table, type TableColumn } from '../../ui/Table';
import { pushToast } from '../../ui/toast-store';
import { CardTitle, ROLES } from './shared';

export function CapabilityMatrix() {
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

export function UserManagement() {
  const users = useAsync(listUsers, undefined, ['users']);
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
    { key: 'id', header: 'ID', cell: (row) => <CopyHash value={row.analyst_id} display={shortId(row.analyst_id)} label={`analyst id of ${row.username}`} size="inherit" />, mono: true },
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
