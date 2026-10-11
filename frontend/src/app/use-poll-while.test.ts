import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePollWhile } from './use-poll-while';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('usePollWhile', () => {
  it('ticks at the interval while active, and not before the first interval has passed', () => {
    const tick = vi.fn();
    renderHook(() => usePollWhile(true, 1000, tick));

    vi.advanceTimersByTime(999);
    expect(tick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(tick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it('never ticks while inactive', () => {
    const tick = vi.fn();
    renderHook(() => usePollWhile(false, 1000, tick));

    vi.advanceTimersByTime(10_000);
    expect(tick).not.toHaveBeenCalled();
  });

  it('stops the moment it becomes inactive, and starts again when it becomes active', () => {
    const tick = vi.fn();
    const { rerender } = renderHook(({ active }) => usePollWhile(active, 1000, tick), { initialProps: { active: true } });
    vi.advanceTimersByTime(1000);
    expect(tick).toHaveBeenCalledTimes(1);

    rerender({ active: false });
    vi.advanceTimersByTime(5000);
    expect(tick).toHaveBeenCalledTimes(1);

    rerender({ active: true });
    vi.advanceTimersByTime(1000);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('always calls the newest tick, so an inline function can be passed', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ tick }) => usePollWhile(true, 1000, tick), { initialProps: { tick: first } });

    rerender({ tick: second });
    vi.advanceTimersByTime(1000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('clears its timer when the component goes away', () => {
    const tick = vi.fn();
    const { unmount } = renderHook(() => usePollWhile(true, 1000, tick));

    unmount();
    vi.advanceTimersByTime(5000);
    expect(tick).not.toHaveBeenCalled();
  });
});
