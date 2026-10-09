import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ listInvestigations: vi.fn(), shell: {} as Record<string, unknown> }));

vi.mock('../api/client', () => ({
  listInvestigations: h.listInvestigations,
  describeError: (error: unknown) => String(error),
}));
vi.mock('./shell-data', () => ({ useShellData: () => h.shell }));

import { TopNav } from './TopNav';

const metric = (value: number | null) => ({ value, n: 1, as_of: '2026-10-09T00:00:00Z', source: 'test', definition: 'test', reason: null });
const loaded = <T,>(data: T) => ({ data, error: null, loadedAt: '2026-10-09T00:00:00Z', reload: () => undefined });

beforeEach(() => {
  h.listInvestigations.mockResolvedValue({ items: [], total: metric(null), limit: 8, offset: 0 });
  h.shell = {
    me: loaded({ analyst_id: 'd2d7d8fe-c5d4-4415-98fa-0a8916db732e', username: 'soc_lead', role: 'forensic_analyst', capabilities: [], token_expires_at: '2026-10-09T06:36:01Z' }),
    status: loaded({
      api_version: '2.4.0',
      debate_slot: { status: 'running', investigation_id: '6bb8b105-83cf-418d-982b-dcf4d9d3f49e' },
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
