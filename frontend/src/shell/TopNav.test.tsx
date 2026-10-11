import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ listInvestigations: vi.fn(), getLiveStatus: vi.fn(), shell: {} as Record<string, unknown> }));

vi.mock('../api/client', () => ({
  listInvestigations: h.listInvestigations,
  getLiveStatus: h.getLiveStatus,
  describeError: (error: unknown) => String(error),
}));
vi.mock('./shell-data', () => ({ useShellData: () => h.shell }));

import { TopNav } from './TopNav';

const metric = (value: number | null) => ({ value, n: 1, as_of: '2026-10-09T00:00:00Z', source: 'test', definition: 'test', reason: null });
function liveStatus(state: 'running' | 'stopped' = 'stopped', llmState = 'off', rows = 0) {
  return {
    state,
    consumed: metric(rows),
    llm: { provider: 'openai', state: llmState, activation_rows: metric(1500), rows_seen: metric(rows) },
  };
}
const loaded = <T,>(data: T) => ({ data, error: null, loadedAt: '2026-10-09T00:00:00Z', reload: () => undefined });
/** The debate slots with these investigations running (none: idle), out of 4. */
const slot = (ids: string[]) => ({
  status: ids.length > 0 ? 'running' : 'idle',
  investigation_id: ids[0] ?? null,
  running: metric(ids.length),
  capacity: metric(4),
  investigation_ids: ids,
});

beforeEach(() => {
  h.getLiveStatus.mockResolvedValue(liveStatus());
  h.listInvestigations.mockResolvedValue({ items: [], total: metric(null), limit: 8, offset: 0 });
  h.shell = {
    me: loaded({ analyst_id: 'd2d7d8fe-c5d4-4415-98fa-0a8916db732e', username: 'soc_lead', role: 'forensic_analyst', capabilities: [], token_expires_at: '2026-10-09T06:36:01Z' }),
    status: loaded({
      api_version: '2.4.0',
      debate_slot: slot(['6bb8b105-83cf-418d-982b-dcf4d9d3f49e']),
      sandbox: { is_simulated_violations: metric(0) },
    }),
    health: loaded({ latencyMs: 12 }),
    stats: loaded({ threats_24h: metric(2) }),
  };
});

describe('TopNav search', () => {
  it('opens the command palette from the Search button', () => {
    render(<TopNav onMenuToggle={() => undefined} onSignOut={() => undefined} />);
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Search \(/ }));
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy();
  });

  it('toggles the palette with Ctrl+K and with Cmd+K', () => {
    render(<TopNav onMenuToggle={() => undefined} onSignOut={() => undefined} />);
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'K', ctrlKey: true });
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy();
  });

  it('ignores a plain k and does not open over another open dialog', () => {
    render(
      <>
        <div role="dialog" aria-modal="true" aria-label="Other" />
        <TopNav onMenuToggle={() => undefined} onSignOut={() => undefined} />
      </>,
    );
    fireEvent.keyDown(document, { key: 'k' });
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
  });

  it('puts a copy button on the shortened running-investigation id and analyst id', () => {
    render(<TopNav onMenuToggle={() => undefined} onSignOut={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Copy running investigation id' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy analyst id' })).toBeTruthy();
    expect(screen.getByText('6bb8b105')).toBeTruthy();
    expect(screen.getByText('d2d7d8fe')).toBeTruthy();
  });
});

describe('TopNav debate chip', () => {
  const ids = ['6bb8b105-83cf-418d-982b-dcf4d9d3f49e', '7cc9c216-94d0-429e-a93c-e0e5ea4a0f5f', '8dd0d327-a5e1-43af-b04d-f1f6fb5b1a60'];
  const withSlot = (value: ReturnType<typeof slot>) => {
    h.shell = { ...h.shell, status: loaded({ api_version: '2.4.0', debate_slot: value, sandbox: { is_simulated_violations: metric(0) } }) };
  };

  it('counts the debates running side by side against the slots', () => {
    withSlot(slot(ids));
    render(<TopNav onMenuToggle={() => undefined} onSignOut={() => undefined} />);
    expect(screen.getByText('3 debates running of 4')).toBeTruthy();
  });

  it('says idle when no slot is held', () => {
    withSlot(slot([]));
    render(<TopNav onMenuToggle={() => undefined} onSignOut={() => undefined} />);
    expect(screen.getByText('Debate engine idle')).toBeTruthy();
  });
});

describe('TopNav live feed chip', () => {
  it('says the feed is off while it is stopped', async () => {
    render(<TopNav onMenuToggle={() => undefined} onSignOut={() => undefined} />);

    expect(await screen.findByText('Live feed off')).toBeTruthy();
  });

  it('shows the rows streamed and where the OpenAI switch-on stands', async () => {
    h.getLiveStatus.mockResolvedValue(liveStatus('running', 'warming_up', 1204));
    render(<TopNav onMenuToggle={() => undefined} onSignOut={() => undefined} />);

    expect(await screen.findByText('Live · 1,204 rows · OpenAI after 1,500')).toBeTruthy();
  });

  it('says OpenAI is on once the rows have streamed', async () => {
    h.getLiveStatus.mockResolvedValue(liveStatus('running', 'active', 1800));
    render(<TopNav onMenuToggle={() => undefined} onSignOut={() => undefined} />);

    expect(await screen.findByText('Live · 1,800 rows · OpenAI on')).toBeTruthy();
  });

  it.each([
    ['budget_reached', 'Live · 1,800 rows · OpenAI budget used'],
    ['allowance_reached', 'Live · 1,800 rows · OpenAI key limit'],
    ['not_configured', 'Live · 1,800 rows · OpenAI not set'],
  ])('names the reason OpenAI is not being called (%s), never a bare row count', async (llmState, text) => {
    h.getLiveStatus.mockResolvedValue(liveStatus('running', llmState, 1800));
    render(<TopNav onMenuToggle={() => undefined} onSignOut={() => undefined} />);

    expect(await screen.findByText(text)).toBeTruthy();
  });
});
