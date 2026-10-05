/** Last reported state of the live investigation socket. Read by the footer. */
export interface LiveStatus {
  state: 'connecting' | 'open' | 'reconnecting' | 'closed';
  attempt: number;
}

let current: LiveStatus | null = null;
const listeners = new Set<() => void>();

export function publishLiveStatus(status: LiveStatus): void {
  current = status;
  for (const listener of listeners) listener();
}

/** null until a socket has been opened in this page. */
export function getLiveStatus(): LiveStatus | null {
  return current;
}

export function subscribeLiveStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
