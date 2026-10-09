import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FilterMenu, activeFilterCount, type FilterGroup } from './FilterMenu';

const PROOF = { source: 'GET /things', n: 1, asOf: null, definition: 'Filters become query parameters.' };

const STATUS = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
];
const AGENT = [
  { value: 'ALL', label: 'All agents' },
  { value: 'a', label: 'Agent A' },
];

function Harness({ onChange = () => undefined }: { onChange?: (id: string, value: string) => void }) {
  const [values, setValues] = useState({ status: 'ALL', agent: 'ALL' });
  const set = (id: 'status' | 'agent') => (value: string) => {
    setValues((current) => ({ ...current, [id]: value }));
    onChange(id, value);
  };
  const groups: FilterGroup[] = [
    { id: 'status', label: 'Status', value: values.status, options: STATUS, onChange: set('status') },
    { id: 'agent', label: 'Primary agent', value: values.agent, options: AGENT, onChange: set('agent'), hint: values.agent === 'a' ? 'Reads the A dataset' : null },
  ];
  return (
    <>
      <p>outside</p>
      <FilterMenu groups={groups} onClear={() => setValues({ status: 'ALL', agent: 'ALL' })} proof={PROOF} />
    </>
  );
}

describe('FilterMenu', () => {
  it('counts only groups that are not on their first option', () => {
    const groups: FilterGroup[] = [
      { id: 'a', label: 'A', value: 'ALL', options: STATUS, onChange: () => undefined },
      { id: 'b', label: 'B', value: 'open', options: STATUS, onChange: () => undefined },
    ];
    expect(activeFilterCount(groups)).toBe(1);
  });

  it('opens a panel with one select per group and reports each change', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: 'Filters' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'closed' } });
    expect(onChange).toHaveBeenCalledWith('status', 'closed');
  });

  it('moves focus into the panel when it opens', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.getByRole('dialog', { name: 'Filters' }).contains(document.activeElement)).toBe(true);
  });

  it('shows how many filters are active and a one-line hint for the chosen option', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'open' } });
    fireEvent.change(screen.getByLabelText('Primary agent'), { target: { value: 'a' } });
    expect(screen.getByRole('button', { name: 'Filters, 2 active' })).toBeTruthy();
    expect(screen.getByText('Reads the A dataset')).toBeTruthy();
  });

  it('clears every filter at once', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect((screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'open' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('ALL');
    expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy();
  });

  it('closes on Escape and returns focus to the button', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Filters' });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Filters' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on a click outside but not on a click inside', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.mouseDown(screen.getByLabelText('Status'));
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeTruthy();
    fireEvent.mouseDown(screen.getByText('outside'));
    expect(screen.queryByRole('dialog', { name: 'Filters' })).toBeNull();
  });
});
