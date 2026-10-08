/**
 * The only module that calls fetch (scripts/no-bluff-check.mjs enforces it). One function
 * per endpoint in plan section 3. Every response is typed in ./types.ts.
 */
import type {
  AuditListParams,
  AuditTrailResponse,
  AuditVerifyResult,
  CitationListParams,
  CitationPage,
  CredibilityHistoryParams,
  CredibilityRow,
  EvaluationResponse,
  EvidenceBundleResponse,
  FaultInjectionRequest,
  FaultInjectionResponse,
  FleetEntry,
  HealthResponse,
  InvestigationCitations,
  InvestigationDetail,
  InvestigationListParams,
  InvestigationPage,
  InvestigatorId,
  ContainmentResponse,
  Me,
  QuarantineState,
  RawLogCounts,
  RawLogRecentParams,
  RawLogRow,
  RbacMatrix,
  ReleaseResponse,
  ResponseAction,
  Role,
  ScenarioSummary,
  Settings,
  SettingsUpdate,
  SignResponse,
  SimulateAccepted,
  SimulateRequest,
  StatsResponse,
  SystemStatus,
  TokenResponse,
  UserRow,
  WsTicket,
} from './types';

const DEFAULT_API_BASE = 'http://127.0.0.1:8000';
const TOKEN_KEY = 'verdictchain_token';

export const API_BASE: string = import.meta.env.VITE_API_BASE || DEFAULT_API_BASE;

/** ws:// or wss:// base for the investigation socket, derived from the API base. */
export function wsBaseUrl(): string {
  return API_BASE.replace(/^http/, 'ws');
}

// ---- token storage -------------------------------------------------------------

// Used only when localStorage is blocked, so a login still lasts for the current page.
let memoryToken: string | null = null;

export function getToken(): string | null {
  try {
    const stored = window.localStorage.getItem(TOKEN_KEY);
    if (stored) return stored;
  } catch {
    // Storage blocked (private window, cleared site data). Fall back to the memory token.
  }
  return memoryToken;
}

export function setToken(token: string): void {
  memoryToken = token;
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // The memory token still covers this page.
  }
}

export function clearToken(): void {
  memoryToken = null;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing stored to remove.
  }
}

// ---- errors and the 401 handler -------------------------------------------------

export type ApiErrorKind =
  | 'network'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'locked'
  | 'validation'
  | 'rate_limited'
  | 'server'
  | 'unknown';

function kindForStatus(status: number): ApiErrorKind {
  if (status === 0) return 'network';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 422) return 'validation';
  if (status === 423) return 'locked';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'unknown';
}

/** Every failed call throws this. status 0 means the API could not be reached. */
export class ApiError extends Error {
  readonly status: number;
  readonly kind: ApiErrorKind;
  /** The raw FastAPI detail, if any. */
  readonly detail: unknown;

  constructor(status: number, message: string, detail: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.kind = kindForStatus(status);
    this.detail = detail;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Plain-words text for any failure, for error states and toasts. */
export function describeError(error: unknown): string {
  if (isApiError(error)) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Try again.';
}

let unauthorizedHandler: (() => void) | null = null;

/** The app registers one handler. It runs after any 401 has cleared the stored token. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

// ---- request core ----------------------------------------------------------------

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT';
  body?: unknown;
  /** Public calls (health, login, register) send no token and never trigger the 401 handler. */
  public?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withQuery(path: string, query: object = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query) as Array<[string, unknown]>) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

async function readDetail(response: Response): Promise<unknown> {
  try {
    const body: unknown = await response.json();
    return isRecord(body) && 'detail' in body ? body.detail : body;
  } catch {
    return null;
  }
}

function messageFor(response: Response, detail: unknown): string {
  if (typeof detail === 'string' && detail.trim() !== '') return detail;
  if (Array.isArray(detail)) {
    const messages = detail.flatMap((item: unknown) =>
      isRecord(item) && typeof item.msg === 'string' ? [item.msg] : [],
    );
    if (messages.length > 0) return messages.join('; ');
  }
  if (response.status === 401) return 'Your session has expired. Sign in again.';
  return response.statusText || `Request failed with status ${response.status}.`;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = options.public ? null : getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, 'API unreachable. Check that the backend is running.');
  }

  if (response.status === 401 && !options.public) {
    clearToken();
    unauthorizedHandler?.();
  }
  if (!response.ok) {
    const detail = await readDetail(response);
    throw new ApiError(response.status, messageFor(response, detail), detail);
  }
  // 204 and empty bodies are valid for void endpoints (feedback).
  const text = await response.text();
  if (response.status === 204 || text === '') return undefined as T;
  try {
    // Trusted to match the typed contract in types.ts. There is no runtime schema check.
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(response.status, 'The API returned a response the console could not read.');
  }
}

// ---- public and session ----------------------------------------------------------

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health', { public: true });
}

export function register(username: string, password: string): Promise<TokenResponse> {
  return request<TokenResponse>('/auth/register', { method: 'POST', body: { username, password }, public: true });
}

export function login(username: string, password: string): Promise<TokenResponse> {
  return request<TokenResponse>('/auth/login', { method: 'POST', body: { username, password }, public: true });
}

export function getMe(): Promise<Me> {
  return request<Me>('/auth/me');
}

/** Single-use ticket for the investigation socket (the JWT never goes in a URL). */
export function getWsTicket(): Promise<WsTicket> {
  return request<WsTicket>('/auth/ws-ticket', { method: 'POST' });
}

// ---- system, settings, rbac, users ----------------------------------------------

export function getSystemStatus(): Promise<SystemStatus> {
  return request<SystemStatus>('/system/status');
}

export function getSettings(): Promise<Settings> {
  return request<Settings>('/settings');
}

export function updateSettings(body: SettingsUpdate): Promise<Settings> {
  return request<Settings>('/settings', { method: 'PUT', body });
}

export function getRbacMatrix(): Promise<RbacMatrix> {
  return request<RbacMatrix>('/rbac/matrix');
}

export function listUsers(): Promise<UserRow[]> {
  return request<UserRow[]>('/users');
}

export function updateUserRole(userId: string, role: Role): Promise<UserRow> {
  return request<UserRow>(`/users/${encodeURIComponent(userId)}/role`, { method: 'PUT', body: { role } });
}

// ---- investigations ----------------------------------------------------------------

export function listInvestigations(params: InvestigationListParams = {}): Promise<InvestigationPage> {
  return request<InvestigationPage>(withQuery('/investigations', params));
}

export function getInvestigation(id: string): Promise<InvestigationDetail> {
  return request<InvestigationDetail>(`/investigations/${encodeURIComponent(id)}`);
}

export function getInvestigationCitations(id: string): Promise<InvestigationCitations> {
  return request<InvestigationCitations>(`/investigations/${encodeURIComponent(id)}/citations`);
}

export function getEvidenceBundle(id: string): Promise<EvidenceBundleResponse> {
  return request<EvidenceBundleResponse>(`/investigations/${encodeURIComponent(id)}/evidence-bundle`);
}

/** Audited acknowledgement (capability sign_evidence_bundle). Not a cryptographic signature. */
export function signInvestigation(id: string): Promise<SignResponse> {
  return request<SignResponse>(`/investigations/${encodeURIComponent(id)}/sign`, { method: 'POST' });
}

export function submitFeedback(id: string, verdictWasCorrect: boolean): Promise<void> {
  return request<void>(`/investigations/${encodeURIComponent(id)}/feedback`, {
    method: 'POST',
    body: { verdict_was_correct: verdictWasCorrect },
  });
}

/** Starts a simulated scenario. The console always sends wait=false and follows the socket. */
export function simulateInvestigation(body: SimulateRequest): Promise<SimulateAccepted> {
  return request<SimulateAccepted>('/investigations/simulate', { method: 'POST', body });
}

export function emergencyContainment(id: string): Promise<ContainmentResponse> {
  return request<ContainmentResponse>(`/investigations/${encodeURIComponent(id)}/emergency-containment`, {
    method: 'POST',
    body: { confirm: true },
  });
}

export function releaseContainment(id: string): Promise<ReleaseResponse> {
  return request<ReleaseResponse>(`/investigations/${encodeURIComponent(id)}/release-containment`, {
    method: 'POST',
  });
}

// ---- citations and raw logs ----------------------------------------------------------

export function listCitations(params: CitationListParams = {}): Promise<CitationPage> {
  return request<CitationPage>(withQuery('/citations', params));
}

export function getRawLog(rowId: string): Promise<RawLogRow> {
  return request<RawLogRow>(`/raw-logs/${encodeURIComponent(rowId)}`);
}

export function listRecentRawLogs(params: RawLogRecentParams = {}): Promise<RawLogRow[]> {
  return request<RawLogRow[]>(withQuery('/raw-logs/recent', params));
}

export function getRawLogCounts(): Promise<RawLogCounts> {
  return request<RawLogCounts>('/raw-logs/counts');
}

// ---- audit and response actions -----------------------------------------------------

export function listAuditTrail(params: AuditListParams = {}): Promise<AuditTrailResponse> {
  return request<AuditTrailResponse>(withQuery('/audit-trail', params));
}

/** Server-side chain verification. Not itself audited. */
export function verifyAuditTrail(): Promise<AuditVerifyResult> {
  return request<AuditVerifyResult>('/audit-trail/verify', { method: 'POST' });
}

export function listResponseActions(params: { limit?: number } = {}): Promise<ResponseAction[]> {
  return request<ResponseAction[]>(withQuery('/response-actions', params));
}

// ---- stats, scenarios, evaluation, fleet, agent operations -------------------------

export function getStats(): Promise<StatsResponse> {
  return request<StatsResponse>('/stats');
}

export function listScenarios(): Promise<ScenarioSummary[]> {
  return request<ScenarioSummary[]>('/scenarios');
}

export function getEvaluation(): Promise<EvaluationResponse> {
  return request<EvaluationResponse>('/evaluation');
}

export function getAgentFleet(): Promise<FleetEntry[]> {
  return request<FleetEntry[]>('/agents/fleet');
}

export function getCredibilityHistory(
  agentId: InvestigatorId,
  params: CredibilityHistoryParams = {},
): Promise<CredibilityRow[]> {
  return request<CredibilityRow[]>(withQuery(`/agents/${encodeURIComponent(agentId)}/credibility-history`, params));
}

/** Dry run only (capability override_fault_weights). Changes no production state. */
export function injectFault(agentId: InvestigatorId, body: FaultInjectionRequest): Promise<FaultInjectionResponse> {
  return request<FaultInjectionResponse>(`/agents/${encodeURIComponent(agentId)}/fault-injection`, {
    method: 'POST',
    body,
  });
}

export function quarantineAgent(agentId: InvestigatorId, reason: string): Promise<QuarantineState> {
  return request<QuarantineState>(`/agents/${encodeURIComponent(agentId)}/quarantine`, {
    method: 'POST',
    body: { reason },
  });
}

export function restoreAgent(agentId: InvestigatorId, note: string): Promise<QuarantineState> {
  return request<QuarantineState>(`/agents/${encodeURIComponent(agentId)}/restore`, {
    method: 'POST',
    body: { note },
  });
}
