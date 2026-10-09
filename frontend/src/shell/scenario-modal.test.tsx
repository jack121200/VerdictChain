import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RbacMatrix } from '../api/types';

const h = vi.hoisted(() => ({ getRbacMatrix: vi.fn(), mounts: vi.fn() }));

vi.mock('../api/client', () => ({ getRbacMatrix: h.getRbacMatrix, describeError: (error: unknown) => String(error) }));

// The real modal loads scenarios and posts a simulation. A stand-in that shows its props is enough here.
vi.mock('../features/scenario', async () => {
  const { createElement, useEffect } = await import('react');
  return {
    default: (props: { open: boolean; canInject: boolean; initialScenario: string | null; onClose: () => void }) => {
      useEffect(() => {
        h.mounts();
      }, []);
      return createElement(
        'div',
        { 'data-testid': 'scenario-modal', 'data-open': String(props.open), 'data-can-inject': String(props.canInject), 'data-initial': props.initialScenario ?? '' },
        createElement('button', { type: 'button', onClick: props.onClose }, 'close stub'),
      );
    },
  };
});

import { RunScenarioAction } from './RunScenarioAction';
import { ScenarioModalContext, ScenarioModalProvider, useScenarioModal } from './scenario-modal';

const MATRIX = {
  roles: ['secops_lead', 'forensic_analyst', 'red_team_auditor', 'watchdog_supervisor'],
  capabilities: { inject_scenario: ['secops_lead', 'forensic_analyst'] },
} as unknown as RbacMatrix;

function Opener({ scenario }: { scenario?: 'DDoS' | null }) {
  const control = useScenarioModal();
  return (
    <button type="button" onClick={() => control?.open(scenario ?? null)}>
      open modal
    </button>
  );
}

beforeEach(() => {
  h.mounts.mockClear();
  h.getRbacMatrix.mockResolvedValue(MATRIX);
});

describe('ScenarioModalProvider', () => {
  it('mounts no modal until the first opening, then opens it with the chosen scenario', async () => {
    render(
      <ScenarioModalProvider canInject>
        <Opener scenario="DDoS" />
      </ScenarioModalProvider>,
    );
    expect(screen.queryByTestId('scenario-modal')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'open modal' }));
    const modal = await screen.findByTestId('scenario-modal');
    expect(modal.getAttribute('data-open')).toBe('true');
    expect(modal.getAttribute('data-initial')).toBe('DDoS');
    expect(modal.getAttribute('data-can-inject')).toBe('true');
  });

  it('closes the modal and starts each opening from a fresh instance', async () => {
    render(
      <ScenarioModalProvider canInject>
        <Opener />
      </ScenarioModalProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'open modal' }));
    await screen.findByTestId('scenario-modal');
    fireEvent.click(screen.getByRole('button', { name: 'close stub' }));
    expect(screen.getByTestId('scenario-modal').getAttribute('data-open')).toBe('false');
    expect(h.mounts).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'open modal' }));
    await act(async () => undefined);
    expect(screen.getByTestId('scenario-modal').getAttribute('data-open')).toBe('true');
    expect(h.mounts).toHaveBeenCalledTimes(2);
  });

  it('passes a missing capability to the modal as false', async () => {
    render(
      <ScenarioModalProvider canInject={null}>
        <Opener />
      </ScenarioModalProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'open modal' }));
    expect((await screen.findByTestId('scenario-modal')).getAttribute('data-can-inject')).toBe('false');
  });
});

describe('RunScenarioAction', () => {
  const withControl = (control: { canInject: boolean | null; open: () => void }) =>
    render(
      <ScenarioModalContext.Provider value={control}>
        <RunScenarioAction />
      </ScenarioModalContext.Provider>,
    );

  it('renders nothing outside the signed-in shell', () => {
    const { container } = render(<RunScenarioAction />);
    expect(container.textContent).toBe('');
  });

  it('opens the shared modal with the inject_scenario capability', () => {
    const open = vi.fn();
    withControl({ canInject: true, open });
    fireEvent.click(screen.getByRole('button', { name: 'Run first scenario' }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('stays disabled until the capability is known', () => {
    withControl({ canInject: null, open: vi.fn() });
    expect((screen.getByRole('button', { name: 'Run first scenario' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('explains which roles can run a scenario when the capability is missing', async () => {
    withControl({ canInject: false, open: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Run first scenario' })).toBeNull();
    expect(await screen.findByText(/Roles that can: SecOps lead, Forensic analyst\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See the capability matrix' }).getAttribute('href')).toBe('#/access');
  });

  it('falls back to a plain sentence when the matrix cannot be read', async () => {
    h.getRbacMatrix.mockRejectedValue(new Error('down'));
    withControl({ canInject: false, open: vi.fn() });
    expect(await screen.findByText(/Ask an analyst whose role holds it\./)).toBeTruthy();
  });
});
