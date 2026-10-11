import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearToken, setToken } from '../api/client';
import App from './App';

/** A minimal metric envelope for the shell's status values. */
const metric = (value: number | null, reason: string | null = null) => ({
  value,
  n: value === null ? 0 : 1,
  as_of: '2026-10-05T14:03:22Z',
  source: 'test',
  definition: 'test value',
  reason,
});

const ANALYST = {
  analyst_id: 'a1b2c3d4-0000-4000-8000-000000000001',
  username: 'analyst',
  role: 'secops_lead',
  capabilities: ['manage_users'],
  token_expires_at: '2026-10-06T00:00:00Z',
};

const SYSTEM_STATUS = {
  api_version: '2.4',
  migration_head: '0006',
  postgres: { ok: true, latency_ms: metric(1.2) },
  redis: { ok: true, latency_ms: metric(0.8) },
  rabbitmq: { ok: true, latency_ms: metric(2) },
  providers: {
    openai: { configured: false, model: null, temperature: metric(null, 'not configured'), calls_24h: metric(0), latency_ms: metric(null, 'no calls'), quota_errors_24h: metric(0) },
  },
  sandbox: { is_simulated_violations: metric(0), actions_total: metric(0) },
  debate_slot: { status: 'idle', investigation_id: null, running: metric(0), capacity: metric(4), investigation_ids: [] },
  intake_paused: false,
  continuous_mode: false,
};

const SETTINGS = {
  eta: 0.15,
  isolation_threshold: 0.3,
  verdict_confidence_threshold: 0.6,
  intake_paused: false,
  debate_rounds: 3,
  starting_crs: 0.5,
  updated_at: null,
  updated_by: null,
};

/** Canned answers by "METHOD /path". Anything else is a 404, which the test would then notice. */
let answers: Record<string, { status: number; body: unknown }>;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  window.location.hash = '';
  clearToken();
  answers = {
    'POST /auth/login': { status: 200, body: { access_token: 'token-1', token_type: 'bearer' } },
    'GET /auth/me': { status: 200, body: ANALYST },
    'GET /system/status': { status: 200, body: SYSTEM_STATUS },
    'GET /health': { status: 200, body: { status: 'ok' } },
    'GET /stats': { status: 200, body: { threats_24h: metric(0) } },
    'GET /settings': { status: 200, body: SETTINGS },
    'GET /audit-trail': { status: 200, body: { entries: [], chain: { valid: true, head_seq: null, total: 0 } } },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${new URL(url).pathname}`;
      const answer = answers[key] ?? { status: 404, body: { detail: `not mocked: ${key}` } };
      return jsonResponse(answer.body, answer.status);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearToken();
  window.location.hash = '';
});

describe('App', () => {
  it('shows the public landing to a visitor with no session', async () => {
    render(<App />);
    expect(await screen.findByRole('button', { name: /launch console/i })).toBeTruthy();
    expect(window.location.hash).toBe('#/landing');
  });

  it('signs in through the API and opens the dashboard shell', async () => {
    window.location.hash = '#/login';
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'analyst' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    // The sidebar nav renders once the dashboard shell is up.
    expect(await screen.findByRole('link', { name: 'Dashboard' })).toBeTruthy();
    expect(window.location.hash).toBe('#/dashboard');
    expect(localStorage.getItem('verdictchain_token')).toBe('token-1');
    // Shell values come from the API, not from the component.
    expect(await screen.findByText('API 2.4')).toBeTruthy();
    expect(await screen.findByText('Sandbox enforced')).toBeTruthy();
    expect(await screen.findByText('Audit chain valid')).toBeTruthy();
    expect(await screen.findByText('analyst')).toBeTruthy();
  });

  it('returns to sign-in with a notice when a later call comes back 401', async () => {
    setToken('stale-token');
    answers['GET /auth/me'] = { status: 401, body: { detail: 'Could not validate credentials' } };
    window.location.hash = '#/dashboard';
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect((await screen.findAllByText('Your session has expired. Sign in again.')).length).toBeGreaterThan(0);
    expect(localStorage.getItem('verdictchain_token')).toBeNull();
    expect(window.location.hash).toBe('#/login');
  });

  it('shows a not-found screen for an unknown route once signed in', async () => {
    setToken('token-1');
    window.location.hash = '#/no-such-screen';
    render(<App />);
    expect(await screen.findByText('Page not found')).toBeTruthy();
  });
});
