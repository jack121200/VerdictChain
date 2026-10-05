import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API_BASE,
  ApiError,
  clearToken,
  describeError,
  getInvestigation,
  getMe,
  getToken,
  getWsTicket,
  listInvestigations,
  login,
  setToken,
  setUnauthorizedHandler,
  simulateInvestigation,
  submitFeedback,
  updateSettings,
} from './client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** The first recorded call: its URL and its RequestInit (method, headers, JSON body). */
function firstCall(fetchMock: ReturnType<typeof vi.fn>): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, init };
}

function headerOf(init: RequestInit, name: string): string | null {
  return new Headers(init.headers).get(name);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  clearToken();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setUnauthorizedHandler(null);
  clearToken();
});

describe('request URL, method and body', () => {
  it('sends a GET with the query string and the bearer token', async () => {
    setToken('tok-1');
    fetchMock.mockResolvedValue(jsonResponse({ items: [], total: { value: 0, n: 0, as_of: '', source: '', definition: '', reason: null }, limit: 5, offset: 0 }));
    await listInvestigations({ limit: 5, status: 'running' });
    const { url, init } = firstCall(fetchMock);
    expect(url).toBe(`${API_BASE}/investigations?limit=5&status=running`);
    expect(init.method).toBe('GET');
    expect(headerOf(init, 'Authorization')).toBe('Bearer tok-1');
    expect(init.body).toBeUndefined();
  });

  it('sends a POST login with a JSON body and no bearer token', async () => {
    setToken('stale');
    fetchMock.mockResolvedValue(jsonResponse({ access_token: 'new', token_type: 'bearer' }));
    const result = await login('analyst', 'correct-horse');
    const { url, init } = firstCall(fetchMock);
    expect(url).toBe(`${API_BASE}/auth/login`);
    expect(init.method).toBe('POST');
    expect(headerOf(init, 'Content-Type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ username: 'analyst', password: 'correct-horse' });
    expect(headerOf(init, 'Authorization')).toBeNull();
    expect(result.access_token).toBe('new');
  });

  it('sends a PUT settings body as JSON', async () => {
    setToken('tok');
    fetchMock.mockResolvedValue(jsonResponse({}));
    await updateSettings({ eta: 0.15, isolation_threshold: 0.3, verdict_confidence_threshold: 0.6, intake_paused: false });
    const { url, init } = firstCall(fetchMock);
    expect(url).toBe(`${API_BASE}/settings`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ eta: 0.15, isolation_threshold: 0.3, verdict_confidence_threshold: 0.6, intake_paused: false });
  });

  it('sends the simulate body exactly as given', async () => {
    setToken('tok');
    fetchMock.mockResolvedValue(jsonResponse({}, 202));
    await simulateInvestigation({ scenario_label: 'DDoS', noise_pct: 15, wait: false });
    const { url, init } = firstCall(fetchMock);
    expect(url).toBe(`${API_BASE}/investigations/simulate`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ scenario_label: 'DDoS', noise_pct: 15, wait: false });
  });

  it('encodes path ids so they cannot add segments', async () => {
    setToken('tok');
    fetchMock.mockResolvedValue(jsonResponse({}));
    await getInvestigation('a/b c');
    expect(firstCall(fetchMock).url).toBe(`${API_BASE}/investigations/a%2Fb%20c`);
  });

  it('calls the ws-ticket endpoint with a POST', async () => {
    setToken('tok');
    fetchMock.mockResolvedValue(jsonResponse({ ticket: 't', expires_in: 30 }));
    const ticket = await getWsTicket();
    expect(firstCall(fetchMock)).toMatchObject({ url: `${API_BASE}/auth/ws-ticket`, init: { method: 'POST' } });
    expect(ticket.expires_in).toBe(30);
  });

  it('accepts an empty 204 for void endpoints', async () => {
    setToken('tok');
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(submitFeedback('inv-1', true)).resolves.toBeUndefined();
    const { url, init } = firstCall(fetchMock);
    expect(url).toBe(`${API_BASE}/investigations/inv-1/feedback`);
    expect(JSON.parse(init.body as string)).toEqual({ verdict_was_correct: true });
  });
});

describe('errors and the 401 path', () => {
  it('clears the stored token and calls the handler on a 401', async () => {
    setToken('stale');
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Could not validate credentials' }, 401));
    const failure = await getMe().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 401, kind: 'unauthorized', message: 'Could not validate credentials' });
    expect(getToken()).toBeNull();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not treat a failed sign-in as an expired session', async () => {
    setToken('keep-me');
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Incorrect username or password' }, 401));
    await expect(login('analyst', 'wrong-password')).rejects.toMatchObject({ status: 401, message: 'Incorrect username or password' });
    expect(handler).not.toHaveBeenCalled();
    expect(getToken()).toBe('keep-me');
  });

  it('maps the status code to an error kind', async () => {
    const cases: Array<[number, string]> = [
      [403, 'forbidden'],
      [404, 'not_found'],
      [409, 'conflict'],
      [422, 'validation'],
      [423, 'locked'],
      [429, 'rate_limited'],
      [502, 'server'],
    ];
    for (const [status, kind] of cases) {
      fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'x' }, status));
      await expect(getMe()).rejects.toMatchObject({ status, kind });
    }
  });

  it('joins a validation detail list into one message', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: [{ msg: 'field required' }, { msg: 'too short' }] }, 422));
    await expect(login('a', 'b')).rejects.toThrow('field required; too short');
  });

  it('reports an unreachable API as status 0 with a clear message', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const failure = await login('analyst', 'correct-horse').catch((error: unknown) => error);
    expect(failure).toMatchObject({ status: 0, kind: 'network', message: 'API unreachable. Check that the backend is running.' });
  });

  it('describes any failure in words', () => {
    expect(describeError(new ApiError(403, 'Missing capability: manage_users'))).toBe('Missing capability: manage_users');
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('odd')).toBe('Something went wrong. Try again.');
  });
});

describe('token storage', () => {
  it('keeps the token in storage when localStorage works', () => {
    setToken('stored');
    expect(window.localStorage.getItem('verdictchain_token')).toBe('stored');
    clearToken();
    expect(window.localStorage.getItem('verdictchain_token')).toBeNull();
  });

  it('keeps the token in memory when localStorage is blocked', () => {
    const working = window.localStorage;
    const blocked = {
      getItem: () => {
        throw new Error('storage blocked');
      },
      setItem: () => {
        throw new Error('storage blocked');
      },
      removeItem: () => {
        throw new Error('storage blocked');
      },
    };
    Object.defineProperty(window, 'localStorage', { value: blocked, configurable: true, writable: true });
    try {
      expect(() => setToken('in-memory')).not.toThrow();
      expect(getToken()).toBe('in-memory');
      expect(() => clearToken()).not.toThrow();
      expect(getToken()).toBeNull();
    } finally {
      Object.defineProperty(window, 'localStorage', { value: working, configurable: true, writable: true });
    }
  });
});
