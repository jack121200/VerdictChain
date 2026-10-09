// Direct API access and state control for the E2E specs. Setup and teardown go through here; the
// assertions are made against the UI. Plain fetch, so no Playwright fixture is needed.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { API_URL, seedRows } from './stack.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
export const AUTH_DIR = join(here, '..', '.auth')
export const STORAGE = {
  analyst: join(AUTH_DIR, 'analyst.json'),
  lead: join(AUTH_DIR, 'lead.json'),
} as const

export const AGENTS = ['network_traffic', 'access_log', 'endpoint_behavior'] as const
export type AgentId = (typeof AGENTS)[number]

export interface E2EUser {
  username: string
  password: string
  token: string
}
export interface E2EUsers {
  analyst: E2EUser
  lead: E2EUser
}

/** The throwaway users the global setup created for this run. */
export function loadUsers(): E2EUsers {
  const file = join(AUTH_DIR, 'users.json')
  if (!existsSync(file)) throw new Error(`${file} is missing: the global setup did not run`)
  return JSON.parse(readFileSync(file, 'utf8')) as E2EUsers
}

export interface ApiResult<T = any> {
  status: number
  body: T
}

/** One API call. Never throws on an HTTP error status; use ok() when only success is acceptable. */
export async function call<T = any>(
  token: string | null,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  const send = () =>
    fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  // Node reuses keep-alive sockets and uvicorn closes idle ones after a few seconds, so a request sent at that
  // moment fails with "fetch failed" before the server has seen it. One retry on a new socket is safe.
  const response = await send().catch(() => send())
  const text = await response.text()
  let parsed: unknown = text
  try {
    parsed = text === '' ? null : JSON.parse(text)
  } catch {
    // keep the raw text
  }
  return { status: response.status, body: parsed as T }
}

/** call(), but any status outside 2xx is an error that names the endpoint and the response body. */
export async function ok<T = any>(
  token: string | null,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<T> {
  const result = await call<T>(token, method, path, body)
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`${method} ${path} -> ${result.status}: ${JSON.stringify(result.body)}`)
  }
  return result.body
}

// ---- state control -------------------------------------------------------------------------------------

/**
 * Back to a known state: no investigations, no audit entries beyond what the specs create, CrS 0.5 for every
 * agent, nobody quarantined, default settings, the stub not fabricating. Users are kept.
 * rows "seed" re-creates the synthetic raw_logs rows, "empty" leaves raw_logs empty.
 */
export async function resetState(rows: 'seed' | 'empty' = 'seed'): Promise<void> {
  seedRows('reset', '--rows', rows)
  await setFabricate([])
}

/** The offline LLM stub (backend/scripts/e2e_server.py): which agents cite wrong values from now on. */
export async function setFabricate(agents: readonly AgentId[]): Promise<void> {
  await ok(null, 'POST', '/__e2e/fabricate', { agents })
}

export async function stubCalls(): Promise<{ groq: number; gemini: number }> {
  return ok(null, 'GET', '/__e2e/stub-calls')
}

// ---- investigations ----------------------------------------------------------------------------------

export interface Investigation {
  investigation_id: string
  status: string
  verdict_class: string | null
  verdict_confidence: number | null
}

/** POST /investigations/simulate with wait=true: returns when the debate and any containment are done. */
export async function injectAndWait(token: string, scenario = 'DDoS'): Promise<string> {
  const accepted = await ok<{ investigation_id: string }>(token, 'POST', '/investigations/simulate', {
    scenario_label: scenario,
  })
  return accepted.investigation_id
}

/** POST /investigations/simulate with wait=false: returns at once, the debate runs in the background. */
export async function injectInBackground(token: string, scenario = 'DDoS'): Promise<string> {
  const accepted = await ok<{ investigation_id: string }>(token, 'POST', '/investigations/simulate', {
    scenario_label: scenario,
    wait: false,
  })
  return accepted.investigation_id
}

export async function getInvestigation(token: string, id: string): Promise<any> {
  return ok(token, 'GET', `/investigations/${id}`)
}

export async function listInvestigations(token: string): Promise<any[]> {
  return ok(token, 'GET', '/investigations')
}

export async function fleet(token: string): Promise<any[]> {
  return ok(token, 'GET', '/agents/fleet')
}

/** Every audit entry, newest first, as the API returns them. */
export async function auditEntries(token: string, limit = 500): Promise<any[]> {
  const trail = await ok<{ entries: any[] }>(token, 'GET', `/audit-trail?limit=${limit}`)
  return trail.entries
}

export function percent(ratio: number, decimals = 1): string {
  return `${(ratio * 100).toFixed(decimals)}%`
}
