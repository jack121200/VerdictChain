import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingPage from './index';

describe('LandingPage', () => {
  it('opens the sign-in screen from every call to action', () => {
    const onEnter = vi.fn();
    render(<LandingPage onEnter={onEnter} />);

    for (const name of [/^Sign in$/, /Launch console/, /Sign in to continue/]) {
      fireEvent.click(screen.getByRole('button', { name }));
    }
    expect(onEnter).toHaveBeenCalledTimes(3);
  });

  it('makes no claim the system does not enforce', () => {
    const { container } = render(<LandingPage onEnter={() => undefined} />);
    const text = container.textContent ?? '';

    // Anyone can register an analyst account, so "authorized personnel only" would be a claim without a mechanism.
    expect(text).not.toMatch(/authorized personnel/i);
    expect(text).toContain('Sign-in required');
    // The sign-off button records an audited acknowledgement; no verdict is "signed-off" by default.
    expect(text).not.toMatch(/signed-off/i);
    expect(text).toContain('an audited verdict');
    // Containment needs a confident verdict AND credible agents (the gate has both conditions).
    expect(text).toContain('A confident verdict backed by credible agents triggers simulated containment');
  });

  it('shows no live number: the page is copy only', () => {
    const { container } = render(<LandingPage onEnter={() => undefined} />);

    expect(container.textContent).not.toMatch(/\d+(\.\d+)?\s?%/);
  });
});
