import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PageState } from './PageState';
import { pageStatus, usePageData } from './use-page-data';

describe('pageStatus', () => {
  it('is loading until something arrives, failed when the first load failed, ready once there is a value', () => {
    expect(pageStatus({ data: undefined, error: null })).toBe('loading');
    expect(pageStatus({ data: undefined, error: 'backend down' })).toBe('failed');
    expect(pageStatus({ data: 0, error: null })).toBe('ready');
    expect(pageStatus({ data: [], error: null })).toBe('ready');
  });

  it('keeps a value from an earlier load ready even when a refresh failed', () => {
    expect(pageStatus({ data: 'old', error: 'backend down' })).toBe('ready');
  });
});

describe('usePageData', () => {
  it('moves from loading to ready and still gives the value, the load time and reload', async () => {
    const load = vi.fn().mockResolvedValue(7);
    const { result } = renderHook(() => usePageData(load));
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data).toBe(7);
    expect(result.current.loadedAt).not.toBeNull();
    expect(typeof result.current.reload).toBe('function');
  });

  it('is failed with the error sentence when the first load fails', async () => {
    const load = vi.fn().mockRejectedValue(new Error('backend down'));
    const { result } = renderHook(() => usePageData(load));
    await waitFor(() => expect(result.current.status).toBe('failed'));
    expect(result.current.error).toBe('backend down');
  });

  it('stays ready with the old value when a refresh fails, and recovers on the next good answer', async () => {
    const load = vi.fn().mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('blip')).mockResolvedValue(2);
    const { result } = renderHook(() => usePageData(load));
    await waitFor(() => expect(result.current.data).toBe(1));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.error).toBe('blip'));
    expect(result.current.status).toBe('ready');
    expect(result.current.data).toBe(1);
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toBe(2));
    expect(result.current.error).toBeNull();
  });

  it('reloads on the interval like useAsync does', async () => {
    const load = vi.fn().mockResolvedValue('ok');
    renderHook(() => usePageData(load, 20));
    await waitFor(() => expect(load.mock.calls.length).toBeGreaterThanOrEqual(3));
  });
});

describe('PageState', () => {
  const skeleton = <div data-testid="skeleton" />;

  it('shows the placeholder while loading and nothing else', () => {
    render(<PageState page={{ status: 'loading', error: null }} skeleton={skeleton} />);
    expect(screen.getByTestId('skeleton')).toBeTruthy();
  });

  it('shows the error sentence, with an optional prefix, when the first load failed', () => {
    render(<PageState page={{ status: 'failed', error: 'backend down' }} skeleton={skeleton} prefix="— " />);
    expect(screen.getByText('— backend down')).toBeTruthy();
    expect(screen.queryByTestId('skeleton')).toBeNull();
  });

  it('renders nothing once there is a value, so the data block follows', () => {
    const { container } = render(<PageState page={{ status: 'ready', error: 'blip' }} skeleton={skeleton} />);
    expect(container.textContent).toBe('');
    expect(screen.queryByTestId('skeleton')).toBeNull();
  });
});
