import { describe, expect, it, vi } from 'vitest';
import { getLiveStatus, publishLiveStatus, subscribeLiveStatus } from './live-status';

describe('live status store', () => {
  it('publishes the latest state to subscribers until they unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLiveStatus(listener);
    publishLiveStatus({ state: 'open', attempt: 0 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getLiveStatus()).toEqual({ state: 'open', attempt: 0 });
    unsubscribe();
    publishLiveStatus({ state: 'closed', attempt: 0 });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
