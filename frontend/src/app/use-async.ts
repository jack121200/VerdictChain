import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError } from '../api/client';

export interface AsyncResult<T> {
  /** The last successful value. Kept when a later refresh fails. */
  data: T | undefined;
  /** Plain-words failure text from the latest attempt, or null. */
  error: string | null;
  /** ISO time of the last successful load, or null if none has succeeded. */
  loadedAt: string | null;
  reload: () => void;
}

/**
 * Loads a value once, then again every intervalMs when given. Failures are kept as text so a
 * component can show an error state. A stale value stays visible next to the error.
 */
export function useAsync<T>(load: () => Promise<T>, intervalMs?: number): AsyncResult<T> {
  const [state, setState] = useState<{ data: T | undefined; error: string | null; loadedAt: string | null }>({
    data: undefined,
    error: null,
    loadedAt: null,
  });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    loadRef.current().then(
      (data) => {
        if (!cancelled) setState({ data, error: null, loadedAt: new Date().toISOString() });
      },
      (error: unknown) => {
        if (!cancelled) setState((previous) => ({ ...previous, error: describeError(error) }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [tick]);

  useEffect(() => {
    if (intervalMs === undefined) return undefined;
    const timer = setInterval(() => setTick((current) => current + 1), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  const reload = useCallback(() => setTick((current) => current + 1), []);
  return { data: state.data, error: state.error, loadedAt: state.loadedAt, reload };
}
