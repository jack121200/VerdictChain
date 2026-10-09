import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvestigationSummary } from '../api/types';

const h = vi.hoisted(() => ({ listInvestigations: vi.fn() }));

vi.mock('../api/client', () => ({
  listInvestigations: h.listInvestigations,
  describeError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

import { CommandPalette } from './CommandPalette';
import { ScenarioModalContext } from './scenario-modal';

function summary(over: Partial<InvestigationSummary> = {}): InvestigationSummary {
  return {
    id: 'e4c7c25e-02ff-44f4-aac1-530598a934cd',
    status: 'contained',
    verdict_class: 'ddos',
    verdict_confidence: 0.9,
    primary_agent: 'network_traffic',
    dataset: 'CICIDS2017',
    noise_pct: 0,
    rounds_complete: 3,
    containment_count: 2,
    trigger_type: 'manual',
    created_at: '2026-10-09T05:14:48Z',
    ...over,
  };
}

const page = (items: InvestigationSummary[]) => ({ items, total: { value: null, n: 0, as_of: '', source: '', definition: '', reason: 'no total' }, limit: 8, offset: 0 });

const OTHER = summary({ id: '6bb8b105-83cf-418d-982b-dcf4d9d3f49e', verdict_class: 'insider_logon_anomaly', dataset: 'CERT r4.2' });

beforeEach(() => {
  window.location.hash = '#/dashboard';
  h.listInvestigations.mockReset();
  h.listInvestigations.mockResolvedValue(page([summary(), OTHER]));
});

afterEach(() => {
  vi.useRealTimers();
});

function open(onClose = vi.fn()) {
  render(<CommandPalette open onClose={onClose} />);
  return { onClose, input: screen.getByRole('combobox', { name: 'Search pages and investigations' }) };
}

describe('CommandPalette', () => {
  it('is a named dialog with a search box in focus, a listbox of pages and the newest investigations', async () => {
    const { input } = open();
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy();
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole('listbox', { name: 'Results' })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Audit trail/ })).toBeTruthy();
    expect(await screen.findByRole('option', { name: /e4c7c25e-02ff-44f4-aac1-530598a934cd/ })).toBeTruthy();
    expect(h.listInvestigations).toHaveBeenCalledWith({ limit: 8, q: undefined });
  });

  it('filters pages as you type, without asking the server until typing pauses', async () => {
    vi.useFakeTimers();
    const { input } = open();
    await act(async () => undefined);
    h.listInvestigations.mockClear();
    fireEvent.change(input, { target: { value: 'aud' } });
    expect(screen.getByRole('option', { name: /Audit trail/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Dashboard/ })).toBeNull();
    expect(h.listInvestigations).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(h.listInvestigations).toHaveBeenCalledTimes(1);
    expect(h.listInvestigations).toHaveBeenCalledWith({ limit: 8, q: 'aud' });
  });

  it('searches investigations by the typed text and says so when none match', async () => {
    const { input } = open();
    await screen.findByRole('option', { name: /e4c7c25e/ });
    h.listInvestigations.mockResolvedValue(page([]));
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(await screen.findByText('No investigation matches "zzz".')).toBeTruthy();
    await waitFor(() => expect(h.listInvestigations).toHaveBeenLastCalledWith({ limit: 8, q: 'zzz' }));
  });

  it('shows a failed search as an error line, keeping the pages usable', async () => {
    h.listInvestigations.mockRejectedValue(new Error('API unreachable'));
    open();
    expect(await screen.findByText('Could not search investigations: API unreachable')).toBeTruthy();
    expect(screen.getByRole('option', { name: /Dashboard/ })).toBeTruthy();
  });

  it('moves with the arrow keys, wraps around, and keeps aria-activedescendant on the active row', async () => {
    const { input } = open();
    await screen.findByRole('option', { name: /e4c7c25e/ });
    const options = screen.getAllByRole('option');
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    const last = screen.getAllByRole('option').at(-1) as HTMLElement;
    expect(last.getAttribute('aria-selected')).toBe('true');
    expect(input.getAttribute('aria-activedescendant')).toBe(last.id);
  });

  it('Enter opens the highlighted page and closes the palette', async () => {
    window.location.hash = '#/overview';
    const { input, onClose } = open();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(window.location.hash).toBe('#/dashboard');
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { value: 'audit' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(window.location.hash).toBe('#/audit');
  });

  it('opens an investigation dossier on Enter', async () => {
    const { input } = open();
    const option = await screen.findByRole('option', { name: /e4c7c25e/ });
    fireEvent.mouseMove(option);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(window.location.hash).toBe('#/investigations/e4c7c25e-02ff-44f4-aac1-530598a934cd');
  });

  it('opens the debate room on Shift+Enter', async () => {
    const { input } = open();
    fireEvent.mouseMove(await screen.findByRole('option', { name: /6bb8b105/ }));
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(window.location.hash).toBe('#/debate/6bb8b105-83cf-418d-982b-dcf4d9d3f49e');
  });

  it('closes on Escape', () => {
    const { onClose } = open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('offers "Inject a scenario" only when the role may, and opens the shared scenario dialog', async () => {
    const openModal = vi.fn();
    const { rerender } = render(
      <ScenarioModalContext.Provider value={{ canInject: true, open: openModal }}>
        <CommandPalette open onClose={() => undefined} />
      </ScenarioModalContext.Provider>,
    );
    fireEvent.click(screen.getByRole('option', { name: /Inject a scenario/ }));
    expect(openModal).toHaveBeenCalledTimes(1);

    rerender(
      <ScenarioModalContext.Provider value={{ canInject: false, open: openModal }}>
        <CommandPalette open onClose={() => undefined} />
      </ScenarioModalContext.Provider>,
    );
    expect(screen.queryByRole('option', { name: /Inject a scenario/ })).toBeNull();
  });
});
