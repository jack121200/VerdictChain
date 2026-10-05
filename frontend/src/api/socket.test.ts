import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectInvestigationSocket } from './socket';
import type { LiveFrame } from './types';

/** Records every socket it creates so a test can drive open, message and close events. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  readonly url: string;
  closedWith: number | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  close(code?: number): void {
    this.closedWith = code ?? null;
  }
}

const roundFrame = (round: number): LiveFrame => ({
  type: 'round_completed',
  investigation_id: 'inv-1',
  round,
  agents: [],
});

function latest(): FakeSocket {
  const socket = FakeSocket.instances[FakeSocket.instances.length - 1];
  if (!socket) throw new Error('no socket was created');
  return socket;
}

const baseOptions = {
  WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
  wsBase: 'ws://api.test',
  initialBackoffMs: 500,
  maxBackoffMs: 8000,
};

beforeEach(() => {
  FakeSocket.instances = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('connectInvestigationSocket', () => {
  it('opens with the ticket in the query string, never a JWT', () => {
    connectInvestigationSocket('inv-1', 'ticket-a', { onFrame: () => undefined }, baseOptions);
    expect(latest().url).toBe('ws://api.test/ws/investigations/inv-1?ticket=ticket-a');
  });

  it('delivers each round once and always delivers snapshots', () => {
    const onFrame = vi.fn();
    connectInvestigationSocket('inv-1', 't', { onFrame }, baseOptions);
    const socket = latest();
    socket.onmessage?.({ data: JSON.stringify(roundFrame(1)) });
    socket.onmessage?.({ data: JSON.stringify(roundFrame(1)) });
    socket.onmessage?.({ data: JSON.stringify(roundFrame(2)) });
    socket.onmessage?.({ data: JSON.stringify({ type: 'snapshot', investigation_id: 'inv-1', status: 'running', rounds: [], credibility: [], actions: [], verdict: null }) });
    socket.onmessage?.({ data: JSON.stringify({ type: 'snapshot', investigation_id: 'inv-1', status: 'running', rounds: [], credibility: [], actions: [], verdict: null }) });
    expect(onFrame.mock.calls.map(([frame]) => (frame as LiveFrame).type)).toEqual([
      'round_completed',
      'round_completed',
      'snapshot',
      'snapshot',
    ]);
  });

  it('drops frames that are not valid JSON or have an unknown type', () => {
    const onFrame = vi.fn();
    connectInvestigationSocket('inv-1', 't', { onFrame }, baseOptions);
    latest().onmessage?.({ data: 'not json' });
    latest().onmessage?.({ data: JSON.stringify({ type: 'mystery' }) });
    expect(onFrame).not.toHaveBeenCalled();
  });

  it('reconnects with a fresh ticket after an abnormal close', async () => {
    const getTicket = vi.fn(async () => 'ticket-2');
    connectInvestigationSocket('inv-1', 'ticket-1', { onFrame: () => undefined }, { ...baseOptions, getTicket });
    latest().onclose?.({ code: 1006 });
    expect(FakeSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(getTicket).toHaveBeenCalledTimes(1);
    expect(latest().url).toContain('ticket=ticket-2');
  });

  it('doubles the delay on each retry, up to the maximum', async () => {
    const getTicket = vi.fn(async () => 't');
    connectInvestigationSocket('inv-1', 't', { onFrame: () => undefined }, { ...baseOptions, getTicket, maxBackoffMs: 1000 });
    latest().onclose?.({ code: 1006 });
    await vi.advanceTimersByTimeAsync(500);
    latest().onclose?.({ code: 1006 });
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSocket.instances).toHaveLength(3);
    latest().onclose?.({ code: 1006 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeSocket.instances).toHaveLength(4);
  });

  it('stops for good on a normal close', async () => {
    const getTicket = vi.fn(async () => 't');
    connectInvestigationSocket('inv-1', 't', { onFrame: () => undefined }, { ...baseOptions, getTicket });
    latest().onclose?.({ code: 1000 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(getTicket).not.toHaveBeenCalled();
  });

  it('closes the socket and cancels a pending retry when the caller closes it', async () => {
    const getTicket = vi.fn(async () => 't');
    const feed = connectInvestigationSocket('inv-1', 't', { onFrame: () => undefined }, { ...baseOptions, getTicket });
    latest().onclose?.({ code: 1006 });
    feed.close();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(getTicket).not.toHaveBeenCalled();
  });
});
