/**
 * Push channel for every screen. One WebSocket (/ws/events, one ticket per connection) delivers a small
 * "changed" event after each committed, audited change. The event names topics only; a screen that cares
 * about a topic refetches through the normal REST endpoints. Nothing here carries data.
 *
 * - Reconnects with exponential backoff and a fresh ticket each time (tickets are single use).
 * - Reports its state so the footer and the data hooks know whether push is live. When it is not,
 *   screens fall back to polling (see app/use-async.ts).
 */
import { getWsTicket, isApiError, wsBaseUrl } from './client';

export type ChangeTopic =
  | 'investigations'
  | 'stats'
  | 'audit'
  | 'credibility'
  | 'agents'
  | 'settings'
  | 'users'
  | 'actions';

export interface ChangeEvent {
  type: 'changed';
  topics: ChangeTopic[];
  investigation_ids: string[];
  actions: string[];
  at: string;
}

export type EventsState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'stopped';

export interface EventsStatus {
  state: EventsState;
  /** Reconnect attempts since the last successful connection. */
  attempt: number;
  /** ISO time of the last change event received, or null. */
  lastEventAt: string | null;
}

// ---- status store (read by the footer and the data hooks) ---------------------------------------

let status: EventsStatus = { state: 'idle', attempt: 0, lastEventAt: null };
const statusListeners = new Set<() => void>();

function setStatus(next: Partial<EventsStatus>): void {
  status = { ...status, ...next };
  for (const listener of statusListeners) listener();
}

export function getEventsStatus(): EventsStatus {
  return status;
}

export function subscribeEventsStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

/** True while the push channel is connected. Data hooks poll only when this is false. */
export function isPushLive(): boolean {
  return status.state === 'live';
}

// ---- change bus -------------------------------------------------------------------------------

type Listener = (event: ChangeEvent) => void;
interface Subscription {
  topics: ReadonlySet<ChangeTopic> | 'all';
  listener: Listener;
}

const subscriptions = new Set<Subscription>();

/** Calls listener for every change event touching one of the topics ('all' = every event). */
export function subscribeChanges(topics: readonly ChangeTopic[] | 'all', listener: Listener): () => void {
  const entry: Subscription = { topics: topics === 'all' ? 'all' : new Set(topics), listener };
  subscriptions.add(entry);
  return () => {
    subscriptions.delete(entry);
  };
}

/** Delivers an event to the matching subscribers. Exported for tests. */
export function dispatchChange(event: ChangeEvent): void {
  setStatus({ lastEventAt: event.at });
  for (const { topics, listener } of [...subscriptions]) {
    if (topics === 'all' || event.topics.some((topic) => topics.has(topic))) listener(event);
  }
}

function parseEvent(data: unknown): ChangeEvent | null {
  if (typeof data !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (record.type !== 'changed' || !Array.isArray(record.topics)) return null;
  return {
    type: 'changed',
    topics: record.topics.filter((topic): topic is ChangeTopic => typeof topic === 'string'),
    investigation_ids: Array.isArray(record.investigation_ids)
      ? record.investigation_ids.filter((id): id is string => typeof id === 'string')
      : [],
    actions: Array.isArray(record.actions) ? record.actions.filter((a): a is string => typeof a === 'string') : [],
    at: typeof record.at === 'string' ? record.at : new Date().toISOString(),
  };
}

// ---- connection -------------------------------------------------------------------------------

export interface LiveEventsOptions {
  /** Overrides for tests and non-default hosts. */
  wsBase?: string;
  WebSocketImpl?: typeof WebSocket;
  getTicket?: () => Promise<string>;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
}

export interface LiveEventsConnection {
  close: () => void;
}

const CLOSE_NORMAL = 1000;
const CLOSE_UNAUTHORIZED = 4401;

/** Opens the push channel and keeps it open until close() is called or the session ends (401). */
export function startLiveEvents(options: LiveEventsOptions = {}): LiveEventsConnection {
  const wsBase = options.wsBase ?? wsBaseUrl();
  const WebSocketCtor = options.WebSocketImpl ?? WebSocket;
  const fetchTicket = options.getTicket ?? (async () => (await getWsTicket()).ticket);
  const initialBackoff = options.initialBackoffMs ?? 500;
  const maxBackoff = options.maxBackoffMs ?? 8000;

  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let closed = false;

  function scheduleReconnect(): void {
    if (closed) return;
    attempt += 1;
    setStatus({ state: 'reconnecting', attempt });
    const delay = Math.min(maxBackoff, initialBackoff * 2 ** (attempt - 1));
    timer = setTimeout(() => {
      timer = null;
      void open();
    }, delay);
  }

  async function open(): Promise<void> {
    if (closed) return;
    setStatus({ state: attempt === 0 ? 'connecting' : 'reconnecting', attempt });

    let ticket: string;
    try {
      ticket = await fetchTicket();
    } catch (error) {
      // A 401 has already cleared the session through the global handler: stop, do not retry.
      if (isApiError(error) && error.status === 401) {
        closed = true;
        setStatus({ state: 'stopped' });
        return;
      }
      scheduleReconnect();
      return;
    }
    if (closed) return;

    const next = new WebSocketCtor(`${wsBase}/ws/events?ticket=${encodeURIComponent(ticket)}`);
    socket = next;
    next.onopen = () => {
      attempt = 0;
      setStatus({ state: 'live', attempt: 0 });
    };
    next.onmessage = (message: MessageEvent<unknown>) => {
      const event = parseEvent(message.data);
      if (event) dispatchChange(event);
    };
    next.onclose = (event: CloseEvent) => {
      if (socket === next) socket = null;
      if (closed) return;
      if (event.code === CLOSE_NORMAL) {
        closed = true;
        setStatus({ state: 'stopped' });
        return;
      }
      // 4401 means the ticket was rejected (expired or already used): fetch a new one like any reconnect.
      if (event.code === CLOSE_UNAUTHORIZED) attempt = Math.max(attempt, 0);
      scheduleReconnect();
    };
  }

  function close(): void {
    if (closed) return;
    closed = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    socket?.close(CLOSE_NORMAL, 'client closed');
    socket = null;
    setStatus({ state: 'stopped', attempt: 0 });
  }

  void open();
  return { close };
}

/** Resets module state between tests. */
export function resetLiveEventsForTests(): void {
  subscriptions.clear();
  statusListeners.clear();
  status = { state: 'idle', attempt: 0, lastEventAt: null };
}
