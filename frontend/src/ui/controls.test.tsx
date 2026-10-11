import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CONTROL_BORDER } from './classes';
import { Select } from './Select';
import { Toggle } from './Toggle';

// A control with no text label of its own is found by its edge, so its edge must reach 3:1 (WCAG 1.4.11).
// scripts/contrast-check.mjs measures the token; these tests keep the controls on that token.
describe('control borders', () => {
  it('names the outline token, not the card-border one that measures 1.4 to 1.7:1', () => {
    expect(CONTROL_BORDER).toBe('border border-outline');
    expect(CONTROL_BORDER).not.toContain('outline-variant');
  });

  it('draws a select with the control border', () => {
    render(<Select label="Speed" value="a" options={[{ value: 'a', label: 'A' }]} onChange={() => undefined} />);

    const select = screen.getByRole('combobox', { name: 'Speed' });
    expect(select.className).toContain(CONTROL_BORDER);
    expect(select.className).not.toContain('outline-variant');
  });

  it('draws an unchecked switch with the control border and a checked one with the primary colour', () => {
    const onChange = vi.fn();
    const { rerender } = render(<Toggle label="Pause" checked={false} onChange={onChange} />);
    const off = screen.getByRole('switch');
    expect(off.className).toContain('border-outline');
    expect(off.className).not.toContain('outline-variant');

    fireEvent.click(off);
    expect(onChange).toHaveBeenCalledWith(true);

    rerender(<Toggle label="Pause" checked onChange={onChange} />);
    expect(screen.getByRole('switch').className).toContain('border-primary');
  });
});
