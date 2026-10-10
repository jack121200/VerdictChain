import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StubBadge } from './StubBadge';

describe('StubBadge', () => {
  it('says so when every answer came from the offline stub', () => {
    render(<StubBadge source="stub" />);
    expect(screen.getByText('Offline stub')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Proof: Offline stub' })).toBeTruthy();
  });

  it('says so when the answers were a mix of stub and real providers', () => {
    render(<StubBadge source="mixed" />);
    expect(screen.getByText('Stub + model')).toBeTruthy();
  });

  it('shows nothing for a real-model investigation or an unknown source', () => {
    const { container, rerender } = render(<StubBadge source="model" />);
    expect(container.textContent).toBe('');
    rerender(<StubBadge source={undefined} />);
    expect(container.textContent).toBe('');
  });
});
