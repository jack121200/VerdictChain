import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScenarioSummary, SimulateAccepted } from '../../api/types';

const h = vi.hoisted(() => ({
  listScenarios: vi.fn(),
  simulateInvestigation: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  listScenarios: h.listScenarios,
  simulateInvestigation: h.simulateInvestigation,
  describeError: (error: unknown) => (error instanceof Error ? error.message : 'error'),
}));

import ScenarioModal from './index';

const metric = (value: number) => ({ value, n: 1, as_of: '2026-10-05T00:00:00Z', source: 'GET /scenarios', definition: 'rows', reason: null });

const SCENARIOS: ScenarioSummary[] = [
  { label: 'Botnet', dataset: 'CICIDS2017', primary_agent: 'network_traffic', row_count: metric(42), description: 'C2 beaconing flows' },
  { label: 'insider_scenario_1', dataset: 'CERT_r4.2', primary_agent: 'access_log', row_count: metric(7), description: 'Off-hours logon anomaly' },
];

const accepted: SimulateAccepted = {
  investigation_id: 'inv-xyz-1',
  status: 'running',
  ws_path: '/ws/investigations/inv-xyz-1',
  noise_pct: 0,
  effective_noise_pct: 0,
  primary_agent: 'network_traffic',
};

beforeEach(() => {
  window.location.hash = '';
  h.listScenarios.mockResolvedValue(SCENARIOS);
  h.simulateInvestigation.mockResolvedValue(accepted);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ScenarioModal', () => {
  it('lists the real scenarios with their row counts', async () => {
    render(<ScenarioModal open onClose={() => undefined} canInject />);
    expect(await screen.findByText('Botnet')).toBeTruthy();
    expect(screen.getByText('insider_scenario_1')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
  });

  it('authorises with wait=false and navigates to the debate by the returned id', async () => {
    render(<ScenarioModal open onClose={() => undefined} canInject />);
    await screen.findByText('Botnet');

    const authorize = screen.getByRole('button', { name: 'Authorize injection' });
    await act(async () => {
      fireEvent.click(authorize);
    });

    await waitFor(() => expect(h.simulateInvestigation).toHaveBeenCalledTimes(1));
    const body = h.simulateInvestigation.mock.calls[0][0];
    expect(body.wait).toBe(false);
    expect(body.scenario_label).toBe('Botnet');
    expect(body.noise_pct).toBe(0);
    await waitFor(() => expect(window.location.hash).toContain('inv-xyz-1'));
  });

  it('disables authorise without the inject_scenario capability', async () => {
    render(<ScenarioModal open onClose={() => undefined} canInject={false} />);
    await screen.findByText('Botnet');
    const authorize = screen.getByRole('button', { name: 'Authorize injection' });
    expect((authorize as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/does not grant the inject_scenario capability/i)).toBeTruthy();
  });
});
