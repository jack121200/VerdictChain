import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FailureBanner } from './FailureBanner';

describe('FailureBanner', () => {
  it('shows the stored reason as a status alert, with the plain consequence', () => {
    render(<FailureBanner investigationId="aaaaaaaa-1111-2222-3333-444444444444" reason="The API restarted while this debate was running." />);

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByTestId('failure-reason').textContent).toBe('The API restarted while this debate was running.');
    expect(screen.getByText(/No verdict was reached and nothing was contained/)).toBeTruthy();
  });

  it('says so when no reason was stored, and does not guess one', () => {
    render(<FailureBanner investigationId="aaaaaaaa-1111-2222-3333-444444444444" reason={null} />);

    expect(screen.getByTestId('failure-reason').textContent).toMatch(/No reason was recorded/);
  });
});
