import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvestigationPage, LiveArrival, LiveLlm, LiveStatus, LiveWindow, Me } from '../../api/types';

const h = vi.hoisted(() => ({
  getLiveStatus: vi.fn(),
  getLiveArrivals: vi.fn(),
  listInvestigations: vi.fn(),
  getMe: vi.fn(),
  getSettings: vi.fn(),
  startLiveFeed: vi.fn(),
  stopLiveFeed: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  getLiveStatus: h.getLiveStatus,
  getLiveArrivals: h.getLiveArrivals,
  listInvestigations: h.listInvestigations,
  getMe: h.getMe,
  getSettings: h.getSettings,
  startLiveFeed: h.startLiveFeed,
  stopLiveFeed: h.stopLiveFeed,
  describeError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));
// The lanes of parallel investigations have their own test file (investigations/OperationsBoard.test.tsx).
vi.mock('../investigations/OperationsBoard', () => ({ OperationsBoard: () => null }));

import { evidenceOutsideMono } from '../../test/evidence';
import { allowance } from '../../test/fixtures';
import { glyphBeside } from '../../test/status';
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

function llm(over: Partial<LiveLlm> = {}): LiveLlm {
  return {
    provider: 'openai',
    configured: true,
    model: 'gpt-4.1-mini',
    state: 'active',
    activation_rows: metric(1500),
    rows_seen: metric(1800),
    tokens_24h: metric(41200),
    token_limit: metric(300000),
    calls_24h: metric(18),
    allowance: allowance({ requests: [34, 50], tokens: [58800, 100000] }),
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
    llm: llm(),
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
      error_reason: null,
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
  h.getSettings.mockResolvedValue({ eta: 0.15, isolation_threshold: 0.3, verdict_confidence_threshold: 0.8, intake_paused: false, debate_rounds: 3, starting_crs: 0.5, updated_at: null, updated_by: null });
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

  it('calls the rows replayed dataset rows in its subtitle, never logs that "arrive" from a network', async () => {
    render(<LivePage />);

    expect(await screen.findByText(/^Dataset rows are replayed on their own/)).toBeTruthy();
    expect(screen.queryByText(/Logs arrive on their own/)).toBeNull();
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

    await waitFor(() =>
      expect(h.startLiveFeed).toHaveBeenCalledWith({ events_per_second: 10, auto_investigate: false, llm_after_rows: 1500 }),
    );
  });

  it('a lead chooses how many rows stream before OpenAI is called, and 1,500 is the default', async () => {
    h.getLiveStatus.mockResolvedValue(status({ state: 'stopped', last_trigger: null, blocked: null, llm: llm({ state: 'off' }) }));
    render(<LivePage />);
    await screen.findByRole('button', { name: 'Start live feed' });

    const choice = screen.getByLabelText('Call OpenAI after') as HTMLSelectElement;
    expect(choice.value).toBe('1500');
    expect(Array.from(choice.options).map((option) => option.value)).toEqual(['300', '1500', '3000', '5000']);
    fireEvent.change(choice, { target: { value: '3000' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start live feed' }));
    });

    await waitFor(() => expect(h.startLiveFeed).toHaveBeenCalledWith({ events_per_second: 4, auto_investigate: true, llm_after_rows: 3000 }));
  });

  it('while warming up it says no OpenAI call has been made and how many rows are still missing', async () => {
    h.getLiveStatus.mockResolvedValue(
      status({ rate: metric(10), llm: llm({ state: 'warming_up', rows_seen: metric(600), activation_rows: metric(1500) }) }),
    );
    render(<LivePage />);

    const card = within(await screen.findByLabelText('Language model'));
    expect(card.getByText('Warming up')).toBeTruthy();
    expect(card.getByText('600 / 1,500')).toBeTruthy();
    expect(card.getByText(/No OpenAI call has been made\. 900 more rows, about 1 m 30 s at the current rate\./)).toBeTruthy();
    expect(card.getByRole('progressbar', { name: 'Rows streamed before OpenAI is called' }).getAttribute('aria-valuenow')).toBe('40');
    expect(card.getByText(/answers every debate · gpt-4\.1-mini/)).toBeTruthy();
  });

  it('once active it shows the tokens and calls used against the budget', async () => {
    render(<LivePage />);

    const card = within(await screen.findByLabelText('Language model'));
    expect(card.getByText('Active')).toBeTruthy();
    expect(card.getByText('The next flagged window starts a debate that OpenAI answers.')).toBeTruthy();
    expect(card.getByText('41,200')).toBeTruthy();
    expect(card.getByText('300,000')).toBeTruthy();
    expect(card.getByText('18')).toBeTruthy();
  });

  it('says so when the token budget is used up and when OpenAI is not configured', async () => {
    h.getLiveStatus.mockResolvedValue(status({ llm: llm({ state: 'budget_reached', tokens_24h: metric(300500) }) }));
    const { unmount } = render(<LivePage />);
    expect(await screen.findByText('Budget reached')).toBeTruthy();
    expect(screen.getByText(/token budget of the last 24 hours is used up/)).toBeTruthy();
    unmount();

    h.getLiveStatus.mockResolvedValue(status({ llm: llm({ state: 'not_configured', configured: false, model: null }) }));
    render(<LivePage />);
    expect(await screen.findByText('Not configured')).toBeTruthy();
    expect(screen.getByText('Set OPENAI_API_KEY in .env: without it no automatic investigation can run.')).toBeTruthy();
  });

  it('puts a glyph beside the status word of an investigation the monitor started', async () => {
    h.listInvestigations.mockResolvedValue({
      ...PAGE,
      items: [
        { ...PAGE.items[0], id: 'cccccccc-1111-2222-3333-444444444444', status: 'contained' },
        { ...PAGE.items[0], id: 'dddddddd-1111-2222-3333-444444444444', status: 'error', error_reason: 'cut off' },
      ],
    });
    render(<LivePage />);

    expect(glyphBeside(await screen.findByText('Contained'))).toBe('shield');
    expect(glyphBeside(screen.getByText('Failed'))).toBe('cancel');
  });

  it('shows every row id and case id in the evidence font', async () => {
    h.getLiveStatus.mockResolvedValue(
      status({ last_trigger: { investigation_id: 'e4c7c25e-02ff-44f4-aac1-530598a934cd', group: 'logon', reason: 'logon window', at: '2026-10-09T10:00:00Z' } }),
    );
    h.getLiveArrivals.mockResolvedValue([{ ...ARRIVAL, row_id: '574a5ec4-b50a-4be0-bb55-d96a032d8f92' }]);
    h.listInvestigations.mockResolvedValue({ ...PAGE, items: [{ ...PAGE.items[0], id: 'e4c7c25e-02ff-44f4-aac1-530598a934cd' }] });
    const { container } = render(<LivePage />);
    await screen.findByText('574a5ec4');
    await screen.findAllByText('e4c7c25e');

    expect(evidenceOutsideMono(container)).toEqual([]);
  });

  it("shows what OpenAI itself allows the key, and says when that is what is holding the feed back", async () => {
    const { unmount } = render(<LivePage />);
    const card = within(await screen.findByLabelText('Language model'));
    const group = within(card.getByRole('group', { name: 'What OpenAI allows this key' }));
    expect(group.getByText('34')).toBeTruthy(); // requests left
    expect(group.getByText('50')).toBeTruthy(); // requests allowed
    expect(group.getByText('58,800')).toBeTruthy(); // tokens left
    expect(group.getByText('100,000')).toBeTruthy(); // tokens allowed
    unmount();

    h.getLiveStatus.mockResolvedValue(
      status({
        llm: llm({
          state: 'allowance_reached',
          allowance: allowance({ requests: [0, 50], tokens: [58800, 100000] }, '2026-10-09T10:29:00Z'),
        }),
      }),
    );
    render(<LivePage />);
    const held = within(await screen.findByLabelText('Language model'));
    expect(held.getByText('Key limit reached')).toBeTruthy();
    expect(held.getByText(/too few requests left for a debate/)).toBeTruthy();
    expect(held.getByRole('status').textContent).toMatch(/OpenAI asked for a wait: nothing is sent to it until/);
  });

  it('a key OpenAI has never answered for has no allowance numbers, only dashes with the reason', async () => {
    h.getLiveStatus.mockResolvedValue(status({ llm: llm({ allowance: allowance(null) }) }));
    render(<LivePage />);

    const card = within(await screen.findByLabelText('Language model'));
    const group = within(card.getByRole('group', { name: 'What OpenAI allows this key' }));
    expect(group.getAllByText('—')).toHaveLength(4); // never a made-up 0
    expect(group.getAllByText('OpenAI has not answered yet, so there is no reading')).toHaveLength(4);
    expect(group.queryByRole('status')).toBeNull();
  });

  it('a feed that was never started shows the activation count as missing with its reason', async () => {
    h.getLiveStatus.mockResolvedValue(
      status({
        state: 'stopped',
        llm: llm({ state: 'off', activation_rows: metric(null, 'the feed has not been started yet'), rows_seen: metric(0), tokens_24h: metric(0) }),
      }),
    );
    render(<LivePage />);

    const card = within(await screen.findByLabelText('Language model'));
    expect(card.getByText('Off')).toBeTruthy();
    expect(card.getByText('0 / —')).toBeTruthy();
    expect(card.getByText('Start the live feed: the row count starts from zero every time.')).toBeTruthy();
  });

  it('the investigations the monitor started show their rounds and their containment', async () => {
    h.listInvestigations.mockResolvedValue({
      ...PAGE,
      items: [{ ...PAGE.items[0], rounds_complete: 3, containment_count: 2, status: 'contained' }],
    });
    render(<LivePage />);

    const table = within(await screen.findByRole('table', { name: 'Investigations started by the live monitor' }));
    expect(table.getByText('3 rounds')).toBeTruthy();
    expect(table.getByText('2 actions')).toBeTruthy();
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
