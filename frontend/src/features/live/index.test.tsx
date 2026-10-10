import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvestigationPage, LiveArrival, LiveStatus, LiveWindow, Me } from '../../api/types';

const h = vi.hoisted(() => ({
  getLiveStatus: vi.fn(),
  getLiveArrivals: vi.fn(),
  listInvestigations: vi.fn(),
  getMe: vi.fn(),
  startLiveFeed: vi.fn(),
  stopLiveFeed: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  getLiveStatus: h.getLiveStatus,
  getLiveArrivals: h.getLiveArrivals,
  listInvestigations: h.listInvestigations,
  getMe: h.getMe,
  startLiveFeed: h.startLiveFeed,
  stopLiveFeed: h.stopLiveFeed,
  describeError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

import { clearToasts, getToasts } from '../../ui/toast-store';
import LivePage from './index';

const metric = <T extends number>(value: T | null, reason: string | null = null) => ({
  value,
  n: value === null ? 0 : 1,
  as_of: '2026-10-09T10:00:00Z',
  source: '/live/status',
  definition: 'a live number',
  reason,
});

function window(group: LiveWindow['group'], over: Partial<LiveWindow> = {}): LiveWindow {
  return {
    group,
    source: { network: 'CICIDS2017 network flows', logon: 'CERT r4.2 logons', device: 'CERT r4.2 device events', file: 'CERT r4.2 file accesses' }[group],
    feature: 'off_hours',
    size: 20,
    rows: 20,
    scored_rows: 20,
    value: 0.05,
    threshold: 0.2,
    z: 0.4,
    suspicion: 0.05,
    flagged: false,
    rule: `${group} window: nothing unusual`,
    evaluated_at: '2026-10-09T10:00:00Z',
    ...over,
  };
}

function status(over: Partial<LiveStatus> = {}): LiveStatus {
  return {
    state: 'running',
    simulated: true,
    notice: 'Simulated replay of dataset rows through RabbitMQ. No real network is monitored.',
    started_at: '2026-10-09T09:55:00Z',
    started_by: 'lead_one',
    events_per_second: 4,
    auto_investigate: true,
    published: metric(120),
    consumed: metric(118),
    rate: metric(3.9),
    backlog: metric(2),
    flagged: metric(3),
    triggered: metric(1),
    triggers_today: metric(1),
    daily_cap: metric(8),
    windows: [
      window('network', { feature: 'log10(1 + Flow Packets/s)', value: 1.4, threshold: 0.5, z: null }),
      window('logon', { flagged: true, suspicion: 0.9, value: 0.8, z: 7.2, rule: 'logon window: mean off_hours 0.80 over 20 rows' }),
      window('device', { rows: 7, value: null, threshold: null, z: null, suspicion: 0, rule: 'waiting for the window to fill' }),
      window('file'),
    ],
    last_trigger: { investigation_id: 'aaaaaaaa-1111-2222-3333-444444444444', group: 'logon', reason: 'logon window: mean off_hours 0.80 over 20 rows', at: '2026-10-09T10:00:00Z' },
    blocked: { reason: 'cooling down: 40 s until the next automatic investigation', at: '2026-10-09T10:00:05Z' },
    error: null,
    generated_at: '2026-10-09T10:00:10Z',
    ...over,
  };
}

const ARRIVAL: LiveArrival = {
  row_id: 'bbbbbbbb-1111-2222-3333-444444444444',
  timestamp: '2010-03-01T00:00:00Z',
  source: 'cert_r4.2_logon',
  event_type: 'logon',
  user_id: 'AAM0658',
  host_id: 'PC-9923',
  arrived_at: '2026-10-09T10:00:09Z',
};

const PAGE: InvestigationPage = {
  items: [
    {
      id: 'cccccccc-1111-2222-3333-444444444444',
      status: 'verdict_reached',
      verdict_class: 'insider_logon_anomaly',
      verdict_confidence: 0.85,
      primary_agent: 'endpoint_behavior',
      dataset: 'CERT r4.2',
      noise_pct: 0,
      rounds_complete: 3,
      containment_count: 0,
      data_source: 'model',
      trigger_type: 'continuous',
      created_at: '2026-10-09T10:00:01Z',
    },
  ],
  total: { value: null, n: 0, as_of: '', source: '', definition: '', reason: 'no total' },
  limit: 8,
  offset: 0,
};

function me(capabilities: Me['capabilities']): Me {
  return { analyst_id: 'a1', username: 'lead_one', role: 'secops_lead', capabilities, token_expires_at: '2026-10-10T00:00:00Z' };
}

beforeEach(() => {
  h.getLiveStatus.mockResolvedValue(status());
  h.getLiveArrivals.mockResolvedValue([ARRIVAL]);
  h.listInvestigations.mockResolvedValue(PAGE);
  h.getMe.mockResolvedValue(me(['control_live_feed']));
  h.startLiveFeed.mockResolvedValue(status());
  h.stopLiveFeed.mockResolvedValue(status({ state: 'stopped' }));
});

afterEach(() => {
  vi.clearAllMocks();
  clearToasts();
});

describe('LivePage', () => {
  it('says plainly that the feed is a simulated replay and shows the numbers the API sent', async () => {
    render(<LivePage />);

    expect(await screen.findByText(/No real network is monitored/)).toBeTruthy();
    expect(screen.getByText('Running')).toBeTruthy();
    const section = screen.getByRole('region', { name: 'Feed numbers' });
    expect(section.textContent).toContain('120');
    expect(section.textContent).toContain('118');
    expect(section.textContent).toContain('3.9');
  });

  it('shows each window with its state: flagged, filling and normal', async () => {
    render(<LivePage />);
    await screen.findByText('CERT r4.2 logons');

    expect(screen.getByText('Flagged')).toBeTruthy();
    expect(screen.getByText('Filling')).toBeTruthy();
    expect(screen.getAllByText('Normal')).toHaveLength(2);
    const windows = within(screen.getByRole('region', { name: 'Monitor windows' }));
    expect(windows.getByText('logon window: mean off_hours 0.80 over 20 rows')).toBeTruthy();
    expect(screen.getByRole('meter', { name: 'Suspicion, CERT r4.2 logons' }).getAttribute('aria-valuenow')).toBe('0.9');
    expect(screen.getByText('flag at ≤')).toBeTruthy(); // the network window reads "at most"
  });

  it('lists the arriving rows and the investigations the monitor started, each linking to its debate', async () => {
    render(<LivePage />);

    expect(await screen.findByText('AAM0658')).toBeTruthy();
    expect(screen.getByText('PC-9923')).toBeTruthy();
    const cases = screen.getAllByRole('link', { name: /aaaaaaaa|cccccccc/ });
    expect(cases.map((link) => link.getAttribute('href'))).toEqual([
      '#/debate/aaaaaaaa-1111-2222-3333-444444444444',
      '#/debate/cccccccc-1111-2222-3333-444444444444',
    ]);
    expect(screen.getByText('Insider logon anomaly')).toBeTruthy();
    expect(screen.getByText('85%')).toBeTruthy();
    expect(screen.getByText('cooling down: 40 s until the next automatic investigation')).toBeTruthy();
  });

  it('a lead can stop a running feed', async () => {
    render(<LivePage />);
    const stop = await screen.findByRole('button', { name: 'Stop live feed' });

    await act(async () => {
      fireEvent.click(stop);
    });

    await waitFor(() => expect(h.stopLiveFeed).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getToasts().map((toast) => toast.message)).toContain('Live feed stopped (audited).'));
  });

  it('a lead can start a stopped feed with the chosen speed and the automatic-investigation switch', async () => {
    h.getLiveStatus.mockResolvedValue(status({ state: 'stopped', last_trigger: null, blocked: null }));
    render(<LivePage />);
    await screen.findByRole('button', { name: 'Start live feed' });

    fireEvent.change(screen.getByLabelText('Replay speed'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Start investigations automatically' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start live feed' }));
    });

    await waitFor(() => expect(h.startLiveFeed).toHaveBeenCalledWith({ events_per_second: 10, auto_investigate: false }));
  });

  it('shows the server message when the feed cannot start', async () => {
    h.getLiveStatus.mockResolvedValue(status({ state: 'stopped' }));
    h.startLiveFeed.mockRejectedValue(new Error('RabbitMQ is not reachable (AMQPConnectionError). Start it with docker compose.'));
    render(<LivePage />);

    const start = await screen.findByRole('button', { name: 'Start live feed' });
    await act(async () => {
      fireEvent.click(start);
    });

    await waitFor(() => expect(getToasts().map((toast) => toast.message).join(' ')).toContain('RabbitMQ is not reachable'));
  });

  it('without the capability there are no controls, only the numbers', async () => {
    h.getMe.mockResolvedValue(me([]));
    render(<LivePage />);

    await screen.findByText('Running');
    await waitFor(() => expect(h.getMe).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Stop live feed' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start live feed' })).toBeNull();
  });

  it('a stopped feed with no rows says it is off and who can start it', async () => {
    h.getLiveStatus.mockResolvedValue(status({ state: 'stopped', last_trigger: null, blocked: null }));
    h.getLiveArrivals.mockResolvedValue([]);
    h.getMe.mockResolvedValue(me([]));
    render(<LivePage />);

    expect(await screen.findByText('The feed is off')).toBeTruthy();
    expect(screen.getByText('A lead or a supervisor can start the live feed.')).toBeTruthy();
    expect(screen.getByText('None yet. A window has to be flagged first.')).toBeTruthy();
    expect(screen.getByText('No flagged window has been refused.')).toBeTruthy();
  });

  it('reports a feed that stopped by itself', async () => {
    h.getLiveStatus.mockResolvedValue(status({ state: 'stopped', error: 'AMQPConnectionError: connection lost' }));
    render(<LivePage />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/The feed stopped by itself: AMQPConnectionError: connection lost/)).toBeTruthy();
  });

  it('a null rate keeps its reason instead of showing zero', async () => {
    h.getLiveStatus.mockResolvedValue(status({ rate: metric(null, 'needs two samples a second apart') }));
    render(<LivePage />);

    expect(await screen.findByText('needs two samples a second apart')).toBeTruthy();
  });
});
