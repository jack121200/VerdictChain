import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { describeError } from '../api/client';
import { getEventsStatus, subscribeChanges, subscribeEventsStatus, type ChangeTopic } from '../api/live-events';

export interface AsyncResult<T> {
  /** The last successful value. Kept when a later refresh fails. */
  data: T | undefined;
  /** Plain-words failure text from the latest attempt, or null. */
  error: string | null;
  /** ISO time of the last successful load, or null if none has succeeded. */
  loadedAt: string | null;
  reload: () => void;
}

/** A burst of change events (one debate emits many) becomes a single refetch. */
const PUSH_DEBOUNCE_MS = 400;
/** With push live, a slow poll is only a safety net for a missed event. */
const SAFETY_POLL_MS = 60_000;
/** Without push (offline socket, Redis down) screens poll at this pace. */
const FALLBACK_POLL_MS = 10_000;

/**
 * Loads a value once, then again whenever it should be fresh. Failures are kept as text so a component
 * can show an error state. A stale value stays visible next to the error.
 *
 * - No `topics`: reloads every `intervalMs` (when given). Used for values that need no live push.
 * - With `topics`: reloads shortly after a change event touching one of them arrives over the push
 *   channel. While the channel is live the poll slows to a safety net; while it is not, the screen
 *   polls every `intervalMs` (default 10 s), so a dropped socket never leaves a page stale.
 * - `deps`: values the loader closes over (an id, a filter). Reloads immediately when any of them changes.
 */
export function useAsync<T>(
  load: () => Promise<T>,
  intervalMs?: number,
  topics?: readonly ChangeTopic[] | 'all',
  deps: readonly (string | number | boolean | null | undefined)[] = [],
): AsyncResult<T> {
  const [state, setState] = useState<{ data: T | undefined; error: string | null; loadedAt: string | null }>({
    data: undefined,
    error: null,
    loadedAt: null,
  });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const pushState = useSyncExternalStore(subscribeEventsStatus, getEventsStatus, getEventsStatus);
  const pushLive = topics !== undefined && pushState.state === 'live';

  const depsKey = deps.map(String).join('|');
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
  }, [tick, depsKey]);

  // Push: refetch shortly after a matching change event.
  const topicsKey = topics === undefined ? null : topics === 'all' ? 'all' : topics.join(',');
  const topicsRef = useRef(topics);
  topicsRef.current = topics;
  useEffect(() => {
    const wanted = topicsRef.current;
    if (wanted === undefined) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeChanges(wanted, () => {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        setTick((current) => current + 1);
      }, PUSH_DEBOUNCE_MS);
    });
    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, [topicsKey]);

  // Polling: the explicit interval, slowed to a safety net while push is live.
  const pollMs =
    topics === undefined ? intervalMs : pushLive ? Math.max(intervalMs ?? SAFETY_POLL_MS, SAFETY_POLL_MS) : (intervalMs ?? FALLBACK_POLL_MS);
  useEffect(() => {
    if (pollMs === undefined) return undefined;
    const timer = setInterval(() => setTick((current) => current + 1), pollMs);
    return () => clearInterval(timer);
  }, [pollMs]);

  const reload = useCallback(() => setTick((current) => current + 1), []);
  return { data: state.data, error: state.error, loadedAt: state.loadedAt, reload };
}
