import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAsync } from './use-async';

describe('useAsync', () => {
  it('loads a value and records when it was loaded', async () => {
    const load = vi.fn().mockResolvedValue(7);
    const { result } = renderHook(() => useAsync(load));
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data).toBe(7));
    expect(result.current.error).toBeNull();
    expect(result.current.loadedAt).not.toBeNull();
  });

  it('keeps the last good value next to the error when a refresh fails', async () => {
    const load = vi.fn().mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('backend down'));
    const { result } = renderHook(() => useAsync(load));
    await waitFor(() => expect(result.current.data).toBe(1));
    result.current.reload();
    await waitFor(() => expect(result.current.error).toBe('backend down'));
    expect(result.current.data).toBe(1);
  });

  it('reloads on the interval when one is given', async () => {
    const load = vi.fn().mockResolvedValue('ok');
    renderHook(() => useAsync(load, 20));
    await waitFor(() => expect(load.mock.calls.length).toBeGreaterThanOrEqual(3));
  });
});
