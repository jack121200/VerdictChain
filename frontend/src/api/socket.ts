/**
 * Live investigation feed (plan 3.5). Takes an investigation id and a ticket, then:
 * - reconnects with exponential backoff, and fetches a fresh ticket each time (tickets are single use);
 * - treats close code 1000 as the end of the feed and stops; any other close reconnects;
 * - dedupes frames by (type, round, agent_id). snapshot frames are state, so they are never deduped.
 */
import { getWsTicket, isApiError, wsBaseUrl } from './client';
import { publishLiveStatus, type LiveStatus } from './live-status';
import type { LiveFrame } from './types';

export interface InvestigationSocketHandlers {
  onFrame: (frame: LiveFrame) => void;
  onStatus?: (status: LiveStatus) => void;
}

export interface InvestigationSocketOptions {
  /** Overrides for tests and non-default hosts. */
  wsBase?: string;
  WebSocketImpl?: typeof WebSocket;
  /** Returns a fresh ticket for each reconnect. Defaults to POST /auth/ws-ticket. */
  getTicket?: () => Promise<string>;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
}

export interface InvestigationSocket {
  close: () => void;
}

const CLOSE_NORMAL = 1000;

const FRAME_TYPES: ReadonlySet<string> = new Set(['snapshot', 'round_completed', 'agent_isolated', 'verdict', 'error']);

function dedupeKey(frame: LiveFrame): string | null {
  switch (frame.type) {
    case 'snapshot':
      return null;
    case 'round_completed':
      return `round_completed|${frame.round}`;
    case 'agent_isolated':
      return `agent_isolated|${frame.round}|${frame.agent_id}`;
    case 'verdict':
      return 'verdict';
    case 'error':
      return 'error';
  }
}

function parseFrame(data: unknown): LiveFrame | null {
  if (typeof data !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || !('type' in parsed)) return null;
  if (typeof parsed.type !== 'string' || !FRAME_TYPES.has(parsed.type)) return null;
  // The shape is trusted to match plan 3.5 (compile-time typing only, no runtime schema).
  return parsed as LiveFrame;
}

export function connectInvestigationSocket(
  investigationId: string,
  ticket: string,
  handlers: InvestigationSocketHandlers,
  options: InvestigationSocketOptions = {},
): InvestigationSocket {
  const wsBase = options.wsBase ?? wsBaseUrl();
  const WebSocketCtor = options.WebSocketImpl ?? WebSocket;
  const fetchTicket = options.getTicket ?? (async () => (await getWsTicket()).ticket);
  const initialBackoff = options.initialBackoffMs ?? 500;
  const maxBackoff = options.maxBackoffMs ?? 8000;

  const seen = new Set<string>();
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let closed = false;
  // The ticket passed in is used for the first connection only.
  let pendingTicket: string | null = ticket;

  function report(state: LiveStatus['state']): void {
    const status: LiveStatus = { state, attempt };
    publishLiveStatus(status);
    handlers.onStatus?.(status);
  }

  function deliver(frame: LiveFrame): void {
    const key = dedupeKey(frame);
    if (key !== null) {
      if (seen.has(key)) return;
      seen.add(key);
    }
    handlers.onFrame(frame);
  }

  function scheduleReconnect(): void {
    if (closed) return;
    attempt += 1;
    report('reconnecting');
    const delay = Math.min(maxBackoff, initialBackoff * 2 ** (attempt - 1));
    timer = setTimeout(() => {
      timer = null;
      void open();
    }, delay);
  }

  async function open(): Promise<void> {
    if (closed) return;
    report(attempt === 0 ? 'connecting' : 'reconnecting');

    let useTicket = pendingTicket;
    pendingTicket = null;
    if (useTicket === null) {
      try {
        useTicket = await fetchTicket();
      } catch (error) {
        // A 401 has already cleared the session through the global handler. Stop here.
        if (isApiError(error) && error.status === 401) {
          closed = true;
          report('closed');
          return;
        }
        scheduleReconnect();
        return;
      }
    }
    if (closed) return;

    const url = `${wsBase}/ws/investigations/${encodeURIComponent(investigationId)}?ticket=${encodeURIComponent(useTicket)}`;
    const next = new WebSocketCtor(url);
    socket = next;
    next.onopen = () => {
      attempt = 0;
      report('open');
    };
    next.onmessage = (event: MessageEvent<unknown>) => {
      const frame = parseFrame(event.data);
      if (frame) deliver(frame);
    };
    next.onclose = (event: CloseEvent) => {
      if (socket === next) socket = null;
      if (closed) return;
      if (event.code === CLOSE_NORMAL) {
        closed = true;
        report('closed');
        return;
      }
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
    report('closed');
  }

  void open();
  return { close };
}
