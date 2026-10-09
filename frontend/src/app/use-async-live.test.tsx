import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchChange, resetLiveEventsForTests, type ChangeEvent } from '../api/live-events';
import * as liveEvents from '../api/live-events';
import { useAsync } from './use-async';

const change = (topics: ChangeEvent['topics']): ChangeEvent => ({
  type: 'changed',
  topics,
  investigation_ids: [],
  actions: [],
  at: '2026-10-09T10:00:00Z',
});

beforeEach(() => {
  resetLiveEventsForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('useAsync with push topics', () => {
  it('refetches shortly after a matching change event', async () => {
    const load = vi.fn().mockResolvedValue('v');
    renderHook(() => useAsync(load, undefined, ['credibility']));
    await settle();
    expect(load).toHaveBeenCalledTimes(1);

    act(() => dispatchChange(change(['credibility'])));
    await settle(500);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('ignores events for other topics', async () => {
    const load = vi.fn().mockResolvedValue('v');
    renderHook(() => useAsync(load, undefined, ['credibility']));
    await settle();

    act(() => dispatchChange(change(['users'])));
    await settle(1000);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('turns a burst of events into one refetch', async () => {
    const load = vi.fn().mockResolvedValue('v');
    renderHook(() => useAsync(load, undefined, ['audit']));
    await settle();

    act(() => {
      for (let i = 0; i < 9; i += 1) dispatchChange(change(['audit']));
    });
    await settle(500);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('refetches immediately when a dependency changes', async () => {
    const load = vi.fn().mockResolvedValue('v');
    const { rerender } = renderHook(({ id }: { id: string }) => useAsync(load, undefined, ['audit'], [id]), {
      initialProps: { id: 'a' },
    });
    await settle();
    expect(load).toHaveBeenCalledTimes(1);

    rerender({ id: 'b' });
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('polls on its own when the push channel is not live (fallback)', async () => {
    const load = vi.fn().mockResolvedValue('v');
    renderHook(() => useAsync(load, 1000, ['audit']));
    await settle();
    // One step per poll: React batches several timer ticks inside a single act() into one render.
    for (let i = 0; i < 3; i += 1) await settle(1000);
    expect(load).toHaveBeenCalledTimes(4); // the first load plus three polls
  });

  it('drops to a slow safety poll while the push channel is live', async () => {
    vi.spyOn(liveEvents, 'getEventsStatus').mockReturnValue({ state: 'live', attempt: 0, lastEventAt: null });
    const load = vi.fn().mockResolvedValue('v');
    renderHook(() => useAsync(load, 1000, ['audit']));
    await settle();
    await settle(10_000);
    expect(load).toHaveBeenCalledTimes(1); // no fast polling while push is live
  });

  it('keeps the old behaviour without topics: no push subscription', async () => {
    const load = vi.fn().mockResolvedValue('v');
    renderHook(() => useAsync(load));
    await settle();
    act(() => dispatchChange(change(['audit', 'credibility', 'investigations'])));
    await settle(1000);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
