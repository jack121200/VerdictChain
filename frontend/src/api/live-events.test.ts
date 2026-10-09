import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dispatchChange,
  getEventsStatus,
  isPushLive,
  resetLiveEventsForTests,
  startLiveEvents,
  subscribeChanges,
  type ChangeEvent,
} from './live-events';

/** A WebSocket stand-in the test drives by hand. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  closedWith: number | null = null;
  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }
  close(code?: number): void {
    this.closedWith = code ?? 1000;
  }
  open(): void {
    this.onopen?.();
  }
  send(data: unknown): void {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent<unknown>);
  }
  drop(code: number): void {
    this.onclose?.({ code } as CloseEvent);
  }
}

const wsImpl = FakeSocket as unknown as typeof WebSocket;
const change = (topics: ChangeEvent['topics'], at = '2026-10-09T10:00:00Z'): ChangeEvent => ({
  type: 'changed',
  topics,
  investigation_ids: [],
  actions: [],
  at,
});

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  FakeSocket.instances = [];
  resetLiveEventsForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('live events bus', () => {
  it('delivers an event only to subscribers of a topic it touches', () => {
    const credibility = vi.fn();
    const settings = vi.fn();
    const everything = vi.fn();
    subscribeChanges(['credibility'], credibility);
    subscribeChanges(['settings'], settings);
    subscribeChanges('all', everything);

    dispatchChange(change(['credibility', 'audit']));

    expect(credibility).toHaveBeenCalledTimes(1);
    expect(settings).not.toHaveBeenCalled();
    expect(everything).toHaveBeenCalledTimes(1);
  });

  it('stops delivering after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeChanges('all', listener);
    unsubscribe();
    dispatchChange(change(['audit']));
    expect(listener).not.toHaveBeenCalled();
  });

  it('records when the last change event arrived', () => {
    dispatchChange(change(['audit'], '2026-10-09T11:11:11Z'));
    expect(getEventsStatus().lastEventAt).toBe('2026-10-09T11:11:11Z');
  });
});

describe('startLiveEvents', () => {
  const options = () => ({
    wsBase: 'ws://api.test',
    WebSocketImpl: wsImpl,
    getTicket: vi.fn().mockResolvedValue('ticket-1'),
    initialBackoffMs: 100,
    maxBackoffMs: 400,
  });

  it('connects with a ticket and reports live once the socket opens', async () => {
    startLiveEvents(options());
    await flush();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.instances[0].url).toBe('ws://api.test/ws/events?ticket=ticket-1');
    expect(getEventsStatus().state).toBe('connecting');
    FakeSocket.instances[0].open();
    expect(getEventsStatus().state).toBe('live');
    expect(isPushLive()).toBe(true);
  });

  it('turns a server message into a change event for subscribers', async () => {
    const listener = vi.fn();
    subscribeChanges(['investigations'], listener);
    startLiveEvents(options());
    await flush();
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.send({ type: 'hello', topics: [] }); // not a change: ignored
    socket.send({ type: 'changed', topics: ['investigations', 'audit'], investigation_ids: ['i1'], actions: ['verdict_reached'], at: '2026-10-09T12:00:00Z' });
    socket.send('not json');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].investigation_ids).toEqual(['i1']);
  });

  it('reconnects with a fresh ticket after an unexpected close, with backoff', async () => {
    const opts = options();
    opts.getTicket.mockResolvedValueOnce('t-a').mockResolvedValueOnce('t-b');
    startLiveEvents(opts);
    await flush();
    FakeSocket.instances[0].open();

    FakeSocket.instances[0].drop(1006);
    expect(getEventsStatus().state).toBe('reconnecting');
    expect(isPushLive()).toBe(false);

    await vi.advanceTimersByTimeAsync(100);
    await flush();
    expect(FakeSocket.instances).toHaveLength(2);
    expect(FakeSocket.instances[1].url).toContain('ticket=t-b');
    FakeSocket.instances[1].open();
    expect(getEventsStatus().state).toBe('live');
    expect(getEventsStatus().attempt).toBe(0);
  });

  it('backs off exponentially up to the cap while the server stays down', async () => {
    const opts = options();
    startLiveEvents(opts);
    await flush();
    FakeSocket.instances[0].drop(1006); // attempt 1 -> 100 ms
    await vi.advanceTimersByTimeAsync(100);
    await flush();
    FakeSocket.instances[1].drop(1006); // attempt 2 -> 200 ms
    await vi.advanceTimersByTimeAsync(199);
    expect(FakeSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(FakeSocket.instances).toHaveLength(3);
  });

  it('stops quietly on a normal close and on close()', async () => {
    const connection = startLiveEvents(options());
    await flush();
    FakeSocket.instances[0].open();
    connection.close();
    expect(FakeSocket.instances[0].closedWith).toBe(1000);
    expect(getEventsStatus().state).toBe('stopped');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('keeps retrying when the ticket request fails for a non-auth reason', async () => {
    const opts = options();
    opts.getTicket.mockRejectedValueOnce(new Error('network down')).mockResolvedValue('t-ok');
    startLiveEvents(opts);
    await flush();
    expect(FakeSocket.instances).toHaveLength(0);
    expect(getEventsStatus().state).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(100);
    await flush();
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
