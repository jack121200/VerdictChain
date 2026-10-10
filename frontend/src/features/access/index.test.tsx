import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Capability, Me, Metric, RbacMatrix, Settings, SystemStatus } from '../../api/types';

vi.mock('../../api/client', () => ({
  describeError: (error: unknown) => String(error),
  emergencyContainment: vi.fn(),
  getMe: vi.fn(),
  getRawLogCounts: vi.fn(),
  getRbacMatrix: vi.fn(),
  getSettings: vi.fn(),
  getSystemStatus: vi.fn(),
  listUsers: vi.fn(),
  releaseContainment: vi.fn(),
  updateSettings: vi.fn(),
  updateUserRole: vi.fn(),
}));

import { getMe, getRawLogCounts, getRbacMatrix, getSettings, getSystemStatus, listUsers } from '../../api/client';
import AccessPage from './index';

const metric = <T = number,>(value: T | null): Metric<T> => ({
  value,
  n: value === null ? 0 : 1,
  as_of: '2026-10-08T00:00:00Z',
  source: 'test',
  definition: 'test',
  reason: value === null ? 'no data' : null,
});

const SETTINGS: Settings = {
  eta: 0.15,
  isolation_threshold: 0.3,
  verdict_confidence_threshold: 0.8,
  intake_paused: false,
  debate_rounds: 3,
  starting_crs: 0.5,
  updated_at: null,
  updated_by: null,
};

const health = { ok: true, latency_ms: metric(3) };
const STATUS = {
  api_version: 'v2',
  migration_head: '0006_quarantine',
  postgres: health,
  redis: health,
  rabbitmq: health,
  providers: {
    groq: { configured: true, model: 'groq-model', temperature: metric(0.2), calls_24h: metric(0), latency_ms: metric(null), quota_errors_24h: metric(0) },
    gemini: { configured: false, model: null, temperature: metric(0.2), calls_24h: metric(0), latency_ms: metric(null), quota_errors_24h: metric(0) },
  },
  sandbox: { is_simulated_violations: metric(0), actions_total: metric(0) },
  debate_slot: { state: 'idle', investigation_id: null },
  intake_paused: false,
  continuous_mode: false,
} as unknown as SystemStatus;

const RBAC: RbacMatrix = {
  roles: ['secops_lead', 'forensic_analyst', 'red_team_auditor', 'watchdog_supervisor'],
  capabilities: {
    sign_evidence_bundle: ['secops_lead'],
    trigger_emergency_containment: ['secops_lead'],
    inject_scenario: ['secops_lead', 'forensic_analyst', 'red_team_auditor', 'watchdog_supervisor'],
    override_fault_weights: ['secops_lead'],
    quarantine_agent: ['secops_lead'],
    manage_users: ['secops_lead'],
    edit_settings: ['secops_lead'],
    control_live_feed: ['secops_lead'],
  },
};

function me(capabilities: Capability[]): Me {
  return { analyst_id: 'id-1234abcd', username: 'river.analyst', role: 'forensic_analyst', capabilities, token_expires_at: '2026-10-09T00:00:00Z' };
}

beforeEach(() => {
  vi.mocked(getSettings).mockResolvedValue(SETTINGS);
  vi.mocked(getSystemStatus).mockResolvedValue(STATUS);
  vi.mocked(getRbacMatrix).mockResolvedValue(RBAC);
  vi.mocked(getRawLogCounts).mockResolvedValue({
    total: metric(1000),
    sources: [{ source: 'cicids2017', count: metric(1000) }],
  });
  vi.mocked(listUsers).mockResolvedValue([]);
  vi.mocked(getMe).mockResolvedValue(me([]));
});

describe('AccessPage', () => {
  it('renders the real identity and the capability matrix from the API', async () => {
    render(<AccessPage />);
    expect(await screen.findByText('river.analyst')).toBeTruthy();
    expect(await screen.findAllByText('Forensic analyst')).not.toHaveLength(0);
    // a real capability name from GET /rbac/matrix
    expect(await screen.findByText('sign_evidence_bundle')).toBeTruthy();
    // real migration head from GET /system/status
    expect(await screen.findByText('0006_quarantine')).toBeTruthy();
  });

  it('says plainly that continuous ingestion is off (a debate starts only on an injection)', async () => {
    render(<AccessPage />);
    expect(await screen.findByText('off · manual injection only')).toBeTruthy();
  });

  it('hides capability-gated controls without the capability', async () => {
    render(<AccessPage />);
    await screen.findByText('river.analyst');
    expect(screen.getByText(/requires the edit_settings capability/i)).toBeTruthy();
    expect(screen.queryByText('User management')).toBeNull();
    expect(screen.queryByText('Emergency containment')).toBeNull();
  });

  it('shows the gated controls when the capabilities are present', async () => {
    vi.mocked(getMe).mockResolvedValue(me(['manage_users', 'trigger_emergency_containment', 'edit_settings']));
    render(<AccessPage />);
    expect(await screen.findByText('User management')).toBeTruthy();
    expect(await screen.findByText('Emergency containment')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/requires the edit_settings capability/i)).toBeNull());
  });

  it('gives the shortened analyst id a copy button and shows the session expiry with its exact time', async () => {
    const { container } = render(<AccessPage />);
    await screen.findByText('river.analyst');
    expect(screen.getByRole('button', { name: 'Copy analyst id' })).toBeTruthy();
    expect(screen.getByText('id-1234a').getAttribute('title')).toBe('id-1234abcd');
    expect(container.querySelector('time[datetime="2026-10-09T00:00:00Z"]')?.getAttribute('title')).toBe('2026-10-09 00:00:00 UTC');
  });
});
