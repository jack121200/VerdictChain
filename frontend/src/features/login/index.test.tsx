import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ login: vi.fn(), register: vi.fn(), setToken: vi.fn() }));

vi.mock('../../api/client', () => ({
  login: h.login,
  register: h.register,
  setToken: h.setToken,
  describeError: (error: unknown) => (error instanceof Error ? error.message : 'error'),
}));

import LoginPage from './index';

beforeEach(() => {
  vi.clearAllMocks();
});

function fill(username: string, password: string) {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: username } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
}

describe('LoginPage', () => {
  it('says what protects the system without claiming access is restricted to authorized people', () => {
    const { container } = render(<LoginPage onSignedIn={() => undefined} />);

    expect(container.textContent).toContain('Protected system. Sign-in required; roles are enforced on the server.');
    expect(container.textContent).not.toMatch(/authorized personnel/i);
  });

  it('draws the two text fields with the control border, whose edge is what finds them', () => {
    render(<LoginPage onSignedIn={() => undefined} />);

    for (const name of ['Username', 'Password']) {
      const field = screen.getByLabelText(name);
      expect(field.className).toContain('border-outline');
      expect(field.className).not.toContain('outline-variant');
    }
  });

  it('checks the lengths in the browser first and sends nothing when they are too short', async () => {
    render(<LoginPage onSignedIn={() => undefined} />);
    fill('ab', 'short');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/at least/i);
    expect(h.login).not.toHaveBeenCalled();
  });

  it('stores the token and moves on after a good sign-in', async () => {
    h.login.mockResolvedValue({ access_token: 'token-1', token_type: 'bearer' });
    const onSignedIn = vi.fn();
    render(<LoginPage onSignedIn={onSignedIn} />);
    fill('analyst_one', 'long-enough-password');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    expect(h.login).toHaveBeenCalledWith('analyst_one', 'long-enough-password');
    expect(h.setToken).toHaveBeenCalledWith('token-1');
  });

  it('shows the server sentence when sign-in fails, and does not move on', async () => {
    h.login.mockRejectedValue(new Error('Invalid username or password'));
    const onSignedIn = vi.fn();
    render(<LoginPage onSignedIn={onSignedIn} />);
    fill('analyst_one', 'wrong-password-here');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Invalid username or password');
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(h.setToken).not.toHaveBeenCalled();
  });

  it('switches to account creation, which says new accounts are analysts and sends no role', async () => {
    h.register.mockResolvedValue({ access_token: 'token-2', token_type: 'bearer' });
    render(<LoginPage onSignedIn={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'New analyst? Create an account' }));

    expect(screen.getByText('New accounts start as forensic analysts.')).toBeTruthy();
    fill('new_analyst', 'long-enough-password');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(h.register).toHaveBeenCalledWith('new_analyst', 'long-enough-password'));
  });
});
