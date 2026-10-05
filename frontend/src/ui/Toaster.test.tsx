import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from './Toaster';
import { clearToasts, dismissToast, getToasts, pushToast } from './toast-store';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('toast store', () => {
  it('dismisses itself after its duration', () => {
    act(() => {
      pushToast('Settings saved', { durationMs: 1000 });
    });
    expect(getToasts().map((toast) => toast.message)).toEqual(['Settings saved']);
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(getToasts()).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(getToasts()).toHaveLength(0);
  });

  it('dismisses a toast by id and cancels its timer', () => {
    const id = pushToast('Copied', { durationMs: 1000 });
    dismissToast(id);
    expect(getToasts()).toHaveLength(0);
    clearToasts();
  });
});

describe('Toaster', () => {
  it('renders a toast and removes it when its duration ends', () => {
    render(<Toaster />);
    act(() => {
      pushToast('Session expired', { tone: 'tertiary', durationMs: 2000 });
    });
    expect(screen.getByRole('status').textContent).toContain('Session expired');
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByText('Session expired')).toBeNull();
  });
});
