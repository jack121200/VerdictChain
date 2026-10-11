import { useEffect, useRef } from 'react';

/**
 * Calls `tick` every `intervalMs` while `active` is true, and stops as soon as it is false. The newest `tick` is
 * always the one called, so a caller can pass an inline function.
 */
export function usePollWhile(active: boolean, intervalMs: number, tick: () => void): void {
  const tickRef = useRef(tick);
  tickRef.current = tick;
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => tickRef.current(), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
}
