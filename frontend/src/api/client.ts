// Real API client - every call here hits the actual FastAPI backend
// (backend/api/main.py). No mock data, no fabricated values.

const API_BASE = 'http://127.0.0.1:8000'
const WS_BASE = 'ws://127.0.0.1:8000'
const TOKEN_KEY = 'verdictchain_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const resp = await fetch(`${API_BASE}${path}`, { ...options, headers })
  if (!resp.ok) {
    let detail = resp.statusText
    try {
      const body = await resp.json()
      detail = body.detail || detail
    } catch {
      // response body wasn't JSON - fall back to statusText
    }
    throw new ApiError(resp.status, detail)
  }
  if (resp.status === 204) return undefined as T
  return resp.json() as Promise<T>
}

// ---- auth ----

export interface TokenResponse {
  access_token: string
  token_type: string
}

export function register(username: string, password: string) {
  return request<TokenResponse>('/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) })
}

export function login(username: string, password: string) {
  return request<TokenResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
}

// ---- investigations ----

export interface CitedEvidence {
  row_id: string
  field: string
  value: string
}

export interface DebateRound {
  round: number
  agent_id: string
  theory: string
  confidence: number
  cited_evidence: CitedEvidence[]
  created_at: string
}

export interface CredibilityEntry {
  round: number
  agent_id: string
  crs_before: number
  crs_after: number
  verification_match_rate: number
  isolated: boolean
  created_at: string
}

export interface ResponseActionEntry {
  action_type: string
  target: string
  reason: string | null
  is_simulated: boolean
  created_at: string
}

export interface InvestigationSummary {
  investigation_id: string
  trigger_type: string
  status: string
  verdict_class: string | null
  verdict_confidence: number | null
  created_at: string
}

export interface InvestigationDetail extends InvestigationSummary {
  debate: DebateRound[]
  credibility: CredibilityEntry[]
  actions: ResponseActionEntry[]
}

export type ScenarioLabel =
  | 'DDoS' | 'Portscan' | 'FTP-Patator' | 'SSH-Patator' | 'Botnet'
  | 'insider_scenario_1' | 'insider_scenario_2' | 'insider_scenario_3'

export interface SimulateResult {
  investigation_id: string
  verdict: {
    verdict_class: string
    verdict_confidence: number
    status: string
    supporting_evidence: CitedEvidence[]
    contributing_agents: string[]
  }
  providers_used: Record<string, string[]>
  actions_taken: ResponseActionEntry[]
}

export function simulateScenario(scenario_label: ScenarioLabel, max_rows_per_agent = 5) {
  return request<SimulateResult>('/investigations/simulate', {
    method: 'POST',
    body: JSON.stringify({ scenario_label, max_rows_per_agent }),
  })
}

export function listInvestigations() {
  return request<InvestigationSummary[]>('/investigations')
}

export function getInvestigation(id: string) {
  return request<InvestigationDetail>(`/investigations/${id}`)
}

export function submitFeedback(id: string, verdict_was_correct: boolean) {
  return request<void>(`/investigations/${id}/feedback`, {
    method: 'POST',
    body: JSON.stringify({ verdict_was_correct }),
  })
}

// ---- agents ----

export interface AgentFleetEntry {
  agent_id: string
  credibility_score: number
  isolated: boolean
}

export function getAgentFleet() {
  return request<AgentFleetEntry[]>('/agents/fleet')
}

// ---- audit trail ----

export interface AuditEntry {
  id: string
  investigation_id: string | null
  actor: string
  action: string
  detail: Record<string, unknown> | null
  entry_hash: string
  created_at: string
}

export interface AuditTrailResponse {
  entries: AuditEntry[]
  chain_valid: boolean
}

export function getAuditTrail(limit = 100) {
  return request<AuditTrailResponse>(`/audit-trail?limit=${limit}`)
}

// ---- response actions (global) ----

export function listResponseActions(limit = 100) {
  return request<ResponseActionEntry[]>(`/response-actions?limit=${limit}`)
}

// ---- WebSocket: live debate feed ----

export function connectScenarioFeed(scenarioLabel: string, onMessage: (msg: Record<string, unknown>) => void): WebSocket {
  const ws = new WebSocket(`${WS_BASE}/ws/scenarios/${encodeURIComponent(scenarioLabel)}`)
  ws.onmessage = (event) => {
    try {
      onMessage(JSON.parse(event.data))
    } catch {
      // ignore malformed frames
    }
  }
  return ws
}
