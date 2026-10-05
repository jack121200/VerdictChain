import type { Role } from '../api/types';

/** Display names for the real analyst roles (backend/api/rbac.py). */
export const ROLE_LABEL: Record<Role, string> = {
  secops_lead: 'SecOps lead',
  forensic_analyst: 'Forensic analyst',
  red_team_auditor: 'Red-team auditor',
  watchdog_supervisor: 'Watchdog supervisor',
};
