import { useEffect, useState } from 'react';
import { describeError } from '../../api/client';

export interface Loadable<T> {
  data: T | undefined;
  error: string | null;
  loadedAt: string | null;
}

/**
 * Loads a value whenever `key` changes (so id-dependent reads refresh on navigation, which the
 * shared useAsync does not). A null key clears the value and makes no call.
 */
export function useLoadable<T>(key: string | null, load: (key: string) => Promise<T>): Loadable<T> {
  const [state, setState] = useState<Loadable<T>>({ data: undefined, error: null, loadedAt: null });

  useEffect(() => {
    if (key === null) {
      setState({ data: undefined, error: null, loadedAt: null });
      return;
    }
    let cancelled = false;
    load(key).then(
      (data) => {
        if (!cancelled) setState({ data, error: null, loadedAt: new Date().toISOString() });
      },
      (error: unknown) => {
        if (!cancelled) setState({ data: undefined, error: describeError(error), loadedAt: null });
      },
    );
    return () => {
      cancelled = true;
    };
    // load is treated as stable for a given key (callers pass a module-level function).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
