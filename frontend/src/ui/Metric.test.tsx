import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Metric as MetricEnvelope } from '../api/types';
import { Metric } from './Metric';
import { Proof } from './Proof';

function envelope(value: number | null, reason: string | null = null): MetricEnvelope<number> {
  return {
    value,
    n: value === null ? 0 : 1,
    as_of: '2026-10-05T14:03:22Z',
    source: '/stats',
    definition: 'Open threat verdicts in the last 24 hours',
    reason,
  };
}

describe('Metric', () => {
  it('shows an em dash and the reason when the value is null, never 0', () => {
    render(<Metric metric={envelope(null, 'no investigations yet')} label="Threat verdicts" />);
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('no investigations yet')).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('shows a real zero as 0 with no reason', () => {
    render(<Metric metric={envelope(0)} label="Threat verdicts" />);
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.queryByText('—')).toBeNull();
  });

  it('formats integers with separators and fractions to two decimals', () => {
    const { rerender } = render(<Metric metric={envelope(1234)} label="Count" />);
    expect(screen.getByText('1,234')).toBeTruthy();
    rerender(<Metric metric={envelope(0.5)} label="Rate" />);
    expect(screen.getByText('0.50')).toBeTruthy();
  });

  it('shows an em dash while the value has not loaded', () => {
    render(<Metric metric={undefined} label="Pending" />);
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('puts its Proof behind a button that names the metric', () => {
    render(<Metric metric={envelope(3)} label="Threat verdicts" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Proof: Threat verdicts' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('/stats');
    expect(dialog.textContent).toContain('Open threat verdicts in the last 24 hours');
    expect(dialog.textContent).toContain('2026-10-05T14:03:22Z');
  });
});

describe('Proof', () => {
  it('lists derived inputs next to the definition', () => {
    render(
      <Proof
        source="browser: lib/derive/verdict.ts"
        n={2}
        asOf={null}
        definition="Mean agent-reported confidence of the supporters"
        inputs={[{ label: 'supporters', value: 'network_traffic, access_log' }]}
        label="Mean confidence"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Proof: Mean confidence' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('browser: lib/derive/verdict.ts');
    expect(dialog.textContent).toContain('network_traffic, access_log');
    expect(dialog.textContent).toContain('not reported');
  });
});
