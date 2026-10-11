import { useAsync, type AsyncResult } from './use-async';

/**
 * Where a page's data stands: nothing has arrived yet, the first load failed, or there is a value (a value
 * kept from an earlier load stays 'ready' even when a refresh failed; its error is still in `error`).
 */
export type PageStatus = 'loading' | 'failed' | 'ready';

export interface PageData<T> extends AsyncResult<T> {
  status: PageStatus;
}

export function pageStatus(result: Pick<AsyncResult<unknown>, 'data' | 'error'>): PageStatus {
  if (result.data !== undefined) return 'ready';
  return result.error === null ? 'loading' : 'failed';
}

/**
 * useAsync with the page state worked out once, so no screen repeats `data === undefined && error === null`.
 * Same arguments and the same refresh behaviour (push topics, polling fallback, reload).
 */
export function usePageData<T>(
  load: () => Promise<T>,
  intervalMs?: number,
  topics?: Parameters<typeof useAsync>[2],
  deps?: Parameters<typeof useAsync>[3],
): PageData<T> {
  const result = useAsync(load, intervalMs, topics, deps);
  return { ...result, status: pageStatus(result) };
}
