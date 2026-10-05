/**
 * Typed API contract for every endpoint in plan section 3. The backend routes must use
 * these field names. Where the plan leaves a shape open, the choice is marked "chosen"
 * and listed in the W0-B report for the backend owners to confirm.
 */

/**
 * Metric envelope (plan R2). value null means "no data": render an em dash and show reason.
 * Never render 0 for missing data. A real count of 0 is value 0.
 */
export interface Metric<T = number> {
  value: T | null;
  n: number;
  as_of: string;
  source: string;
  definition: string;
  reason: string | null;
}

/** JSON-compatible value, used for audit detail (canonical, no labels). */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

// ---- enums and scalars --------------------------------------------------------

/** Role names as stored in analysts.role (backend/api/rbac.py). */
export type Role = 'secops_lead' | 'forensic_analyst' | 'red_team_auditor' | 'watchdog_supervisor';

export type Capability =
  | 'sign_evidence_bundle'
  | 'trigger_emergency_containment'
  | 'inject_scenario'
  | 'override_fault_weights'
  | 'quarantine_agent'
  | 'manage_users'
  | 'edit_settings';

/** The three investigator agents. Display names and domains come from GET /agents/fleet. */
export type InvestigatorId = 'network_traffic' | 'access_log' | 'endpoint_behavior';

export type VerdictClass =
  | 'ddos'
  | 'port_scan'
  | 'brute_force'
  | 'botnet_c2'
  | 'insider_file_exfiltration'
  | 'insider_logon_anomaly'
  | 'benign'
  | 'ambiguous';

/** Chosen: the set from the backend's status writes (debate/verdict.py, self_healing, plan 3.5). */
export type InvestigationStatus = 'running' | 'verdict_reached' | 'ambiguous' | 'contained' | 'failed';

export type Stance = 'CHALLENGE' | 'SUPPORT' | 'REVISE';

export type NoisePct = 0 | 15 | 30;

/** Chosen: dataset names carried on investigations and scenarios. */
export type DatasetName = 'CICIDS2017' | 'CERT_r4.2';

export type ScenarioLabel =
  | 'DDoS'
  | 'Portscan'
  | 'FTP-Patator'
  | 'SSH-Patator'
  | 'Botnet'
  | 'insider_scenario_1'
  | 'insider_scenario_2'
  | 'insider_scenario_3';

export type CitationStatus = 'VERIFIED' | 'DISCREPANCY' | 'INVALID_ROW';

export type CitationReason = 'ok' | 'row_not_found' | 'malformed_row_id' | 'field_not_found' | 'value_mismatch';

export type FaultKind = 'ghost_row' | 'value_mismatch' | 'malformed_row_id';

export type RawFieldValue = string | number | boolean | null;

/** Audit catalog (backend/db/audit.py AUDIT_ACTIONS). Releases use the release:<action> form. */
export const AUDIT_ACTION_NAMES = [
  'investigation_started',
  'round_completed',
  'credibility_update',
  'agent_isolated',
  'agent_restored',
  'agent_quarantined',
  'verdict_reached',
  'analyst_feedback',
  'register',
  'login',
  'role_changed',
  'settings_changed',
  'evidence_bundle_signed',
  'emergency_containment',
  'containment_released',
  'byzantine_fault_injected',
  'lock_account',
  'block_ip_range',
  'trigger_rate_limiting',
  'trigger_audit',
] as const;

export type AuditAction = (typeof AUDIT_ACTION_NAMES)[number] | `release:${string}`;

// ---- auth, session, system, settings, rbac -----------------------------------

export interface TokenResponse {
  access_token: string;
  token_type: string;
}

/** GET /auth/me */
export interface Me {
  analyst_id: string;
  username: string;
  role: Role;
  capabilities: Capability[];
  token_expires_at: string;
}

/** POST /auth/ws-ticket. The ticket is single use and expires in 30 seconds. */
export interface WsTicket {
  ticket: string;
  expires_in: number;
}

/** GET /health */
export interface HealthResponse {
  status: 'ok';
}

export interface ServiceHealth {
  ok: boolean;
  latency_ms: Metric<number>;
}

export interface ProviderStatus {
  configured: boolean;
  model: string | null;
  temperature: Metric<number>;
  calls_24h: Metric<number>;
}

export interface DebateSlot {
  state: 'idle' | 'running';
  investigation_id: string | null;
}

/** GET /system/status. Every numeric field is a Metric (plan R10). Never a key. */
export interface SystemStatus {
  api_version: string;
  migration_head: string | null;
  postgres: ServiceHealth;
  redis: ServiceHealth;
  rabbitmq: ServiceHealth;
  providers: { groq: ProviderStatus; gemini: ProviderStatus };
  sandbox: { is_simulated_violations: Metric<number>; actions_total: Metric<number> };
  debate_slot: DebateSlot;
  intake_paused: boolean;
  continuous_mode: boolean;
}

/** GET /settings. The first four are editable; the last two are read-only constants. */
export interface Settings {
  eta: number;
  isolation_threshold: number;
  verdict_confidence_threshold: number;
  intake_paused: boolean;
  debate_rounds: number;
  starting_crs: number;
  updated_at: string | null;
  updated_by: string | null;
}

/** PUT /settings body: full replace. */
export interface SettingsUpdate {
  eta: number;
  isolation_threshold: number;
  verdict_confidence_threshold: number;
  intake_paused: boolean;
}

/** GET /rbac/matrix (read-only). */
export interface RbacMatrix {
  roles: Role[];
  capabilities: Record<Capability, Role[]>;
}

/** GET /users and PUT /users/{id}/role */
export interface UserRow {
  analyst_id: string;
  username: string;
  role: Role;
  created_at: string;
}

// ---- debate, citations, investigations ----------------------------------------

export interface CitedEvidence {
  row_id: string;
  field: string;
  value: string;
}

/** One agent's turn in one round. */
export interface RoundAgentTurn {
  agent_id: InvestigatorId;
  theory: string;
  /** Agent-reported confidence. Self-reported, not calibrated (R4). */
  confidence: number;
  /** null renders "stance not stated". */
  stance: Stance | null;
  /** Per-call provider, persisted in debate_transcripts.provider. */
  provider: string | null;
  cited_evidence: CitedEvidence[];
  /** Credibility after this round. null when not scored. */
  credibility: number | null;
}

export interface DebateRound {
  round: number;
  agents: RoundAgentTurn[];
}

/** Aggregator vote for one agent (server classify_theory plus matched keywords). */
export interface Vote {
  agent_id: InvestigatorId;
  verdict_class: VerdictClass | null;
  confidence: number | null;
  matched_keywords: string[];
}

/** credibility_log row. */
export interface CredibilityRow {
  investigation_id: string;
  agent_id: InvestigatorId;
  round: number;
  crs_before: number;
  crs_after: number;
  verification_match_rate: number;
  isolated: boolean;
  created_at: string;
}

/** response_actions row. release:<action> rows are the inverse sandbox actions. */
export interface ResponseAction {
  id: string;
  investigation_id: string;
  action_type: string;
  target: string;
  reason: string | null;
  is_simulated: boolean;
  created_at: string;
}

export interface CitationSummary {
  total: number;
  verified: number;
  discrepancy: number;
  invalid_row: number;
  match_rate: Metric<number>;
}

/** One checked citation. expected is the raw value found in the row, if any. */
export interface Citation {
  row_id: string;
  field: string;
  value: string | null;
  expected: string | null;
  status: CitationStatus;
  reason: CitationReason;
  agent_id: InvestigatorId;
  round: number;
  /** SHA-256 of the canonical raw row (plan 3.4). */
  row_fingerprint: string | null;
}

export interface GlobalCitation extends Citation {
  investigation_id: string;
}

/** GET /investigations/{id}/citations */
export interface InvestigationCitations {
  summary: CitationSummary;
  citations: Citation[];
}

/** Row in GET /investigations. Never carries scenario_label. */
export interface InvestigationSummary {
  id: string;
  status: InvestigationStatus;
  verdict_class: VerdictClass | null;
  verdict_confidence: number | null;
  primary_agent: InvestigatorId | null;
  dataset: DatasetName | null;
  noise_pct: NoisePct;
  rounds_complete: number;
  containment_count: number;
  trigger_type: string;
  created_at: string;
}

/** GET /investigations/{id} */
export interface InvestigationDetail {
  id: string;
  status: InvestigationStatus;
  verdict_class: VerdictClass | null;
  verdict_confidence: number | null;
  primary_agent: InvestigatorId | null;
  dataset: DatasetName | null;
  noise_pct: NoisePct;
  effective_noise_pct: number | null;
  trigger_type: string;
  trigger_reason: string | null;
  rounds: DebateRound[];
  citations: CitationSummary;
  credibility: CredibilityRow[];
  actions: ResponseAction[];
  votes: Vote[];
  created_at: string;
}

/** Paged list. total is a Metric (plan R2). */
export interface InvestigationPage {
  items: InvestigationSummary[];
  total: Metric<number>;
  limit: number;
  offset: number;
}

/** Paged global citations (GET /citations). */
export interface CitationPage {
  items: GlobalCitation[];
  total: Metric<number>;
  limit: number;
  offset: number;
}

/**
 * The evidence bundle: verdict, transcript, credibility, actions and citation re-check,
 * canonical JSON (sorted keys, compact separators, no labels). Chosen key names.
 */
export interface EvidenceBundle {
  investigation_id: string;
  verdict: { verdict_class: VerdictClass | null; verdict_confidence: number | null; status: InvestigationStatus };
  transcript: DebateRound[];
  credibility: CredibilityRow[];
  actions: ResponseAction[];
  citation_recheck: CitationSummary;
}

/** GET /investigations/{id}/evidence-bundle */
export interface EvidenceBundleResponse {
  bundle: EvidenceBundle;
  bundle_sha256: string;
}

/** POST /investigations/{id}/sign. An audited acknowledgement, not a cryptographic signature. */
export interface SignResponse {
  investigation_id: string;
  bundle_sha256: string;
  notice: string;
  audit_seq: number;
  recorded_at: string;
}

/** POST /investigations/simulate body. Sent with wait=false by the console. */
export interface SimulateRequest {
  scenario_label: ScenarioLabel;
  max_rows_per_agent?: number;
  noise_pct?: NoisePct;
  wait?: boolean;
}

/** POST /investigations/simulate, 202 body. */
export interface SimulateAccepted {
  investigation_id: string;
  status: InvestigationStatus;
  ws_path: string;
  noise_pct: NoisePct;
  effective_noise_pct: number;
  primary_agent: InvestigatorId;
}

/** POST /investigations/{id}/emergency-containment */
export interface ContainmentResponse {
  investigation_id: string;
  status: InvestigationStatus;
  actions_taken: ResponseAction[];
}

/** POST /investigations/{id}/release-containment */
export interface ReleaseResponse {
  investigation_id: string;
  status: InvestigationStatus;
  released: ResponseAction[];
}

// ---- stats, scenarios, evaluation, fleet --------------------------------------

/** GET /stats. Every KPI is a Metric (plan 3.4). */
export interface StatsResponse {
  threats_24h: Metric<number>;
  active: Metric<number>;
  insider_count: Metric<number>;
  /** Mean agent-reported confidence over insider verdicts. Not accuracy (R4). */
  mean_agent_confidence: Metric<number>;
  /** Mean CrS across the three investigators. */
  mean_crs: Metric<number>;
  citations: {
    total: Metric<number>;
    verified: Metric<number>;
    discrepancy: Metric<number>;
    invalid_row: Metric<number>;
    verified_rate: Metric<number>;
  };
  self_healing: {
    actions_total: Metric<number>;
    non_simulated: Metric<number>;
    simulated_share: Metric<number>;
  };
  watchdog: {
    checks: Metric<number>;
    citations_checked: Metric<number>;
    discrepancies: Metric<number>;
    isolations: Metric<number>;
  };
  feedback: {
    total: Metric<number>;
    confirmed: Metric<number>;
    false_positive: Metric<number>;
  };
  /** Brier score from analyst feedback only. null until feedback exists. */
  brier: Metric<number>;
}

/** GET /scenarios: the 8 real labels. */
export interface ScenarioSummary {
  label: ScenarioLabel;
  dataset: DatasetName;
  primary_agent: InvestigatorId;
  row_count: Metric<number>;
  description: string;
}

export interface PerClassMetrics {
  verdict_class: VerdictClass;
  support: Metric<number>;
  precision: Metric<number>;
  recall: Metric<number>;
  f1: Metric<number>;
}

export interface ConfusionCell {
  actual: VerdictClass;
  predicted: VerdictClass;
  count: Metric<number>;
}

export interface NoiseBucket {
  noise_pct: NoisePct;
  accuracy: Metric<number>;
  labelled: Metric<number>;
}

/** GET /evaluation: labelled investigations only. Accuracy comes only from here (R4). */
export interface EvaluationResponse {
  labelled: Metric<number>;
  accuracy: Metric<number>;
  acceptable_accuracy: Metric<number>;
  family_accuracy: Metric<number>;
  abstain_rate: Metric<number>;
  per_class: PerClassMetrics[];
  confusion: ConfusionCell[];
  by_noise: NoiseBucket[];
}

/** One row of GET /agents/fleet. Every numeric field is a Metric (plan R10). */
export interface FleetEntry {
  agent_id: InvestigatorId;
  display_name: string;
  domain: string;
  signals: string[];
  provider_chain: string[];
  model: string | null;
  temperature: Metric<number>;
  crs: Metric<number>;
  isolated: boolean;
  rounds_scored: Metric<number>;
  citations_verified: Metric<number>;
  citations_total: Metric<number>;
  invalid_rate: Metric<number>;
  last_vote: VerdictClass | null;
}

/** Allow-listed raw log row. Never ground_truth_label. */
export interface RawLogRow {
  row_id: string;
  timestamp: string | null;
  source: string;
  source_file: string | null;
  event_type: string | null;
  user_id: string | null;
  host_id: string | null;
  severity: string | null;
  raw_fields: Record<string, RawFieldValue>;
}

export interface RawLogCount {
  source: string;
  count: Metric<number>;
}

// ---- audit --------------------------------------------------------------------

export interface AuditEntry {
  seq: number;
  prev_hash: string | null;
  entry_hash: string;
  /** The exact pre-image that is hashed. The browser recomputes SHA-256 over it. */
  hash_input: string;
  actor: string;
  action: AuditAction;
  detail: Record<string, JsonValue> | null;
  investigation_id: string | null;
  created_at: string;
}

export interface AuditChain {
  valid: boolean;
  head_seq: number | null;
  total: number;
}

/** GET /audit-trail */
export interface AuditTrailResponse {
  entries: AuditEntry[];
  chain: AuditChain;
}

/** POST /audit-trail/verify (not audited) */
export interface AuditVerifyResult {
  chain_valid: boolean;
  entries_checked: number;
  first_break_seq: number | null;
  reason: string | null;
  head_hash: string | null;
}

// ---- agents (quarantine, faults) ----------------------------------------------

export interface QuarantineState {
  agent_id: InvestigatorId;
  active: boolean;
  reason: string | null;
  set_by: string | null;
  updated_at: string;
}

/** POST /agents/{id}/fault-injection, dry run only. Writes nothing. */
export interface FaultInjectionResponse {
  agent_id: InvestigatorId;
  kind: FaultKind;
  dry_run: true;
  citation_check: { status: CitationStatus; reason: CitationReason };
  projected: {
    eta: number;
    isolation_threshold: number;
    trajectory: Array<{ round: number; crs: number }>;
  };
  production_crs: { before: Metric<number>; after: Metric<number> };
  production_unchanged: boolean;
}

// ---- realtime -----------------------------------------------------------------

/** WS /ws/investigations/{id} frames. Deduplicated by (type, round, agent_id). */
export type LiveFrame =
  | {
      type: 'snapshot';
      investigation_id: string;
      status: InvestigationStatus;
      rounds: DebateRound[];
      credibility: CredibilityRow[];
      actions: ResponseAction[];
      verdict: { verdict_class: VerdictClass | null; verdict_confidence: number | null } | null;
    }
  | {
      type: 'round_completed';
      investigation_id: string;
      round: number;
      agents: RoundAgentTurn[];
    }
  | {
      type: 'agent_isolated';
      investigation_id: string;
      agent_id: InvestigatorId;
      round: number;
    }
  | {
      type: 'verdict';
      investigation_id: string;
      verdict: VerdictClass | null;
      status: InvestigationStatus;
      actions_taken: ResponseAction[];
    }
  | {
      type: 'error';
      investigation_id: string;
      detail: string;
    };

// ---- request parameter shapes -------------------------------------------------

export interface InvestigationListParams {
  limit?: number;
  offset?: number;
  status?: InvestigationStatus;
  verdict_class?: VerdictClass;
  trigger_type?: string;
  primary_agent?: InvestigatorId;
  q?: string;
}

export interface CitationListParams {
  limit?: number;
  offset?: number;
  agent_id?: InvestigatorId;
  status?: CitationStatus;
}

export interface AuditListParams {
  limit?: number;
  before_seq?: number;
  action?: AuditAction;
  actor?: string;
  investigation_id?: string;
}

export interface RawLogRecentParams {
  limit?: number;
  source?: string;
}

export interface CredibilityHistoryParams {
  limit?: number;
  since?: string;
}

export interface FaultInjectionRequest {
  kind: FaultKind;
  rounds: number;
}
