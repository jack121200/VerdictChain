import { useSyncExternalStore } from 'react';

/** The clock is read in 10 s steps, so a relative time is never more than 10 s behind the real one. */
const STEP_MS = 10_000;

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

/** One shared timer for every mounted relative time. It starts with the first one and stops with the last. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    timer = setInterval(() => {
      for (const notify of listeners) notify();
    }, STEP_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** The browser clock rounded down to the step, so the value is stable between ticks. */
function snapshot(): number {
  return Math.floor(Date.now() / STEP_MS) * STEP_MS;
}

/** The current time in ms (browser clock). Components that show relative times re-render from it every 10 s. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
