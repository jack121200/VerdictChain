/**
 * One finished, contained case with every part a printed document reads (investigation, citations, evidence bundle,
 * audit entries, case chain, settings, fleet, analyst, raw rows), consistent with each other: the bundle's SHA-256
 * really is the hash of its canonical JSON and the case chain's hashes really are SHA-256 of their hash_input.
 */
import type {
  AuditAction,
  AuditEntry,
  Citation,
  EvidenceBundleResponse,
  FleetEntry,
  InvestigationCitations,
  InvestigationDetail,
  InvestigatorId,
  Me,
  RawLogRow,
  ResponseAction,
  Settings,
  Vote,
} from '../api/types';
import { INVESTIGATOR_IDS } from '../lib/agents';
import { canonicalJson, sha256Hex } from '../lib/derive/hash';
import { caseChainFixture } from './case-chain';
import { metric } from './fixtures';

export const CASE_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
const T0 = Date.parse('2026-10-11T10:00:00Z');
export const at = (seconds: number): string => new Date(T0 + seconds * 1000).toISOString();

export const AGENTS: readonly InvestigatorId[] = INVESTIGATOR_IDS;

export const SETTINGS: Settings = {
  eta: 0.15,
  isolation_threshold: 0.3,
  verdict_confidence_threshold: 0.8,
  intake_paused: false,
  debate_rounds: 3,
  starting_crs: 0.5,
  updated_at: null,
  updated_by: null,
};

export const ME: Me = {
  analyst_id: 'b0b0b0b0-1111-2222-3333-444444444444',
  username: 'soc_lead',
  role: 'secops_lead',
  capabilities: [],
  token_expires_at: at(3600),
};

/** "network_traffic" reads "Network-Traffic Investigator", as the fleet names it. */
const nameOf = (agentId: InvestigatorId): string =>
  `${agentId
    .split('_')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('-')} Investigator`;
export function fleet(): FleetEntry[] {
  return AGENTS.map((agent_id) => ({
    agent_id,
    display_name: nameOf(agent_id),
    domain: `domain of ${agent_id}`,
    signals: [],
    provider_chain: ['openai'],
    model: 'm',
    temperature: metric(0.2),
    crs: metric(0.9),
    isolated: false,
    rounds_scored: metric(3),
    citations_verified: metric(2),
    citations_total: metric(2),
    invalid_rate: metric(0),
    last_vote: null,
  }));
}

export function action(id: string, type: string, seconds: number, reason: string): ResponseAction {
  return { id, investigation_id: CASE_ID, action_type: type, target: 'U001', reason, is_simulated: true, created_at: at(seconds) };
}

export function detail(overrides: Partial<InvestigationDetail> = {}): InvestigationDetail {
  const votes: Vote[] = AGENTS.map((agent_id) => ({ agent_id, verdict_class: 'ddos', confidence: 0.9, class_source: 'stated', matched_keywords: [] }));
  return {
    id: CASE_ID,
    status: 'contained',
    verdict_class: 'ddos',
    verdict_confidence: 0.9,
    primary_agent: 'network_traffic',
    dataset: 'CICIDS2017',
    noise_pct: 0,
    effective_noise_pct: null,
    data_source: 'model',
    error_reason: null,
    trigger_type: 'continuous',
    trigger_reason: 'network window: flows of one rate',
    rounds: [1, 2, 3].map((round) => ({
      round,
      agents: AGENTS.map((agent_id) => ({
        agent_id,
        theory: `Round ${round} theory of ${agent_id}: a flood from one source.`,
        confidence: 0.9,
        stance: round === 1 ? null : ('SUPPORT' as const),
        provider: 'openai',
        cited_evidence: [],
        credibility: 0.8,
      })),
    })),
    citations: { total: 2, verified: 2, discrepancy: 0, invalid_row: 0, match_rate: metric(1) },
    credibility: AGENTS.flatMap((agent_id) => [1, 2, 3].map((round) => ({ investigation_id: CASE_ID, agent_id, round, crs_before: 0.5 + round / 20, crs_after: 0.55 + round / 20, verification_match_rate: 1, isolated: false, created_at: at(10 * round) }))),
    actions: [action('a1', 'lock_account', 28.7, 'Lock the account the flood came from.'), action('a2', 'trigger_audit', 29, 'Open an audit of the host.')],
    votes,
    created_at: at(0),
    ...overrides,
  };
}

function cite(rowId: string, field: string, value: string, agent: InvestigatorId): Citation {
  return { row_id: rowId, field, value, expected: value, status: 'VERIFIED', reason: 'ok', agent_id: agent, round: 1, row_fingerprint: null };
}

export function citations(): InvestigationCitations {
  return {
    summary: detail().citations,
    citations: [cite('row-late', 'Flow Packets/s', '900', 'network_traffic'), cite('row-early', 'Destination Port', '80', 'network_traffic')],
  };
}

export function rawRow(id: string): RawLogRow {
  return {
    row_id: id,
    timestamp: at(id === 'row-early' ? 60 : 300),
    source: 'cicids2017',
    source_file: 'flows.csv',
    event_type: 'network_flow',
    user_id: null,
    host_id: '10.0.0.5',
    severity: null,
    raw_fields: {},
  };
}

function entry(seq: number, action: AuditAction, actor: string, seconds: number, detailBody: AuditEntry['detail'] = null): AuditEntry {
  return { seq, prev_hash: null, entry_hash: `h${seq}`, hash_input: `i${seq}`, actor, action, detail: detailBody, investigation_id: CASE_ID, created_at: at(seconds) };
}

/** The case's audit entries as GET /audit-trail returns them (newest first). */
export function auditEntries(): AuditEntry[] {
  return [
    entry(1, 'investigation_started', 'live_monitor', 0),
    entry(2, 'debate_started', 'debate_queue', 2),
    entry(3, 'round_completed', 'debate_engine', 10, { round: 1 }),
    entry(4, 'round_completed', 'debate_engine', 18, { round: 2 }),
    entry(5, 'round_completed', 'debate_engine', 27, { round: 3 }),
    entry(6, 'verdict_reached', 'debate_engine', 27.5, { verdict_class: 'ddos' }),
    entry(7, 'lock_account', 'self_healing', 28.7),
    entry(8, 'trigger_audit', 'self_healing', 29),
  ].reverse();
}

export async function bundle(d: InvestigationDetail = detail()): Promise<EvidenceBundleResponse> {
  const body = {
    investigation_id: d.id,
    verdict: { verdict_class: d.verdict_class, verdict_confidence: d.verdict_confidence, status: d.status },
    transcript: [],
    credibility: [],
    actions: [],
    citations: { total: 0, verified: 0, discrepancy: 0, invalid_row: 0, items: [] },
  };
  return { bundle: body, bundle_sha256: await sha256Hex(canonicalJson(body)), signatures: [] };
}

export async function chain() {
  return caseChainFixture(
    [
      { seq: 1, action: 'investigation_started' },
      { seq: 2, action: 'debate_started' },
      { seq: 5, action: 'round_completed' },
      { seq: 6, action: 'verdict_reached' },
    ],
    CASE_ID,
    90,
  );
}

interface MockFn {
  mockResolvedValue: (value: unknown) => unknown;
  mockImplementation: (impl: (...args: never[]) => unknown) => unknown;
}

/** The client functions a printed document calls, as mocks. */
export interface CaseClient {
  getInvestigation: MockFn;
  getEvidenceBundle: MockFn;
  getInvestigationCitations: MockFn;
  listAuditTrail: MockFn;
  getCaseAuditChain: MockFn;
  getSettings: MockFn;
  getAgentFleet: MockFn;
  getMe: MockFn;
  getRawLog: MockFn;
}

/** Wires every client function a printed document calls to this case. */
export async function serveCase(client: CaseClient): Promise<void> {
  client.getInvestigation.mockResolvedValue(detail());
  client.getEvidenceBundle.mockResolvedValue(await bundle());
  client.getInvestigationCitations.mockResolvedValue(citations());
  client.listAuditTrail.mockResolvedValue({ entries: auditEntries(), chain: { valid: true, head_seq: 8, total: 90 } });
  client.getCaseAuditChain.mockResolvedValue(await chain());
  client.getSettings.mockResolvedValue(SETTINGS);
  client.getAgentFleet.mockResolvedValue(fleet());
  client.getMe.mockResolvedValue(ME);
  client.getRawLog.mockImplementation(((id: string) => Promise.resolve(rawRow(id))) as never);
}
