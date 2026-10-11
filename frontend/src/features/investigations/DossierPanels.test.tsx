import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditAction, AuditEntry, Citation, InvestigationDetail, ResponseAction, Settings, Vote } from '../../api/types';
import { metric } from '../../test/fixtures';

const client = vi.hoisted(() => ({
  getCaseAuditChain: vi.fn(),
  getRawLog: vi.fn(),
  releaseContainment: vi.fn(),
  submitFeedback: vi.fn(),
  describeError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

vi.mock('../../api/client', () => client);

import { Dossier, type DossierData } from './Dossier';

const ID = 'aaaaaaaa-1111-2222-3333-444444444444';
const T0 = Date.parse('2026-10-11T10:00:00Z');
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();

const SETTINGS: Settings = {
  eta: 0.15,
  isolation_threshold: 0.3,
  verdict_confidence_threshold: 0.8,
  intake_paused: false,
  debate_rounds: 3,
  starting_crs: 0.5,
  updated_at: null,
  updated_by: null,
};

let seq = 0;
function entry(action: AuditAction, actor: string, seconds: number, detail: AuditEntry['detail'] = null): AuditEntry {
  seq += 1;
  return { seq, prev_hash: null, entry_hash: `h${seq}`, hash_input: `i${seq}`, actor, action, detail, investigation_id: ID, created_at: at(seconds) };
}

/** An automatic case that ran end to end: queued 2 s, rounds of 8, 8 and 9 s, a verdict, two sandbox actions. */
function automaticEntries(): AuditEntry[] {
  return [
    entry('investigation_started', 'live_monitor', 0),
    entry('debate_started', 'debate_queue', 2),
    entry('round_completed', 'debate_engine', 10, { round: 1 }),
    entry('round_completed', 'debate_engine', 18, { round: 2 }),
    entry('round_completed', 'debate_engine', 27, { round: 3 }),
    entry('verdict_reached', 'debate_engine', 27.5, { verdict_class: 'ddos' }),
    entry('lock_account', 'self_healing', 28.7),
    entry('trigger_audit', 'self_healing', 29),
  ];
}

function action(id: string, type: string, seconds: number, reason: string): ResponseAction {
  return { id, investigation_id: ID, action_type: type, target: 'U001', reason, is_simulated: true, created_at: at(seconds) };
}

const AGENTS = ['network_traffic', 'access_log', 'endpoint_behavior'] as const;

function detail(overrides: Partial<InvestigationDetail> = {}): InvestigationDetail {
  const votes: Vote[] = AGENTS.map((agent_id) => ({ agent_id, verdict_class: 'ddos', confidence: 0.9, class_source: 'stated', matched_keywords: [] }));
  return {
    id: ID,
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
    rounds: [],
    citations: { total: 2, verified: 2, discrepancy: 0, invalid_row: 0, match_rate: metric(1) },
    credibility: AGENTS.map((agent_id) => ({ investigation_id: ID, agent_id, round: 3, crs_before: 0.8, crs_after: 0.82, verification_match_rate: 1, isolated: false, created_at: at(27) })),
    actions: [action('a1', 'lock_account', 28.7, 'Lock the account the flood came from.'), action('a2', 'trigger_audit', 29, 'Open an audit of the host.')],
    votes,
    created_at: at(0),
    ...overrides,
  };
}

function cite(rowId: string, field: string, value: string): Citation {
  return { row_id: rowId, field, value, expected: value, status: 'VERIFIED', reason: 'ok', agent_id: 'network_traffic', round: 1, row_fingerprint: null };
}

function dossier(overrides: { detail?: InvestigationDetail; entries?: AuditEntry[] } = {}): DossierData {
  const d = overrides.detail ?? detail();
  return {
    id: ID,
    detail: { data: d },
    bundle: {
      data: {
        bundle: {
          investigation_id: ID,
          verdict: { verdict_class: d.verdict_class, verdict_confidence: d.verdict_confidence, status: d.status },
          transcript: [],
          credibility: [],
          actions: [],
          citations: { total: 0, verified: 0, discrepancy: 0, invalid_row: 0, items: [] },
        },
        bundle_sha256: 'c'.repeat(64),
        signatures: [],
      },
    },
    citations: { data: { summary: d.citations, citations: [cite('row-late', 'Flow Packets/s', '900'), cite('row-early', 'Flow Packets/s', '905'), cite('row-late', 'Destination Port', '80')] } },
    audit: { data: { entries: overrides.entries ?? automaticEntries(), chain: { valid: true, head_seq: 8, total: 8 } } },
    loadedAt: at(100),
  };
}

const row = (id: string, seconds: number) => ({
  row_id: id,
  timestamp: at(seconds),
  source: 'cicids2017',
  source_file: 'flows.csv',
  event_type: 'network_flow',
  user_id: null,
  host_id: '10.0.0.5',
  severity: null,
  raw_fields: {},
});

const names = (agentId: string) => agentId;

function renderDossier(data: DossierData, onChanged = vi.fn()) {
  return render(<Dossier dossier={data} onChanged={onChanged} settings={SETTINGS} agentName={names} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
  client.getCaseAuditChain.mockResolvedValue({ investigation_id: ID, entries: [], count: metric(0), case_digest: null, digest_rule: 'rule', chain: { valid: true, head_seq: null, total: 0 } });
  client.getRawLog.mockImplementation(async (id: string) => (id === 'row-early' ? row('row-early', 60) : row('row-late', 300)));
  client.releaseContainment.mockResolvedValue(undefined);
});

describe('Dossier automation timeline', () => {
  it('measures the queue, the rounds, the verdict and the containment, and calls a monitor-started case hands-free', () => {
    renderDossier(dossier());
    const timeline = screen.getByRole('region', { name: 'Automation timeline' });

    expect(within(timeline).getByText('Hands-free · no analyst action')).toBeTruthy();
    expect(within(timeline).getByText('29.0 s')).toBeTruthy(); // end to end
    for (const label of ['Queue', 'Round 1', 'Round 2', 'Round 3', 'Verdict', 'Containment']) expect(within(timeline).getByText(label)).toBeTruthy();
    expect(within(timeline).getByText('DDoS')).toBeTruthy(); // the verdict step names the class
    expect(within(timeline).getByText('2 sandbox actions')).toBeTruthy();
  });

  it('names the analyst instead when a person started the case', () => {
    const entries = [entry('investigation_started', 'soc_lead', 0), entry('debate_started', 'debate_queue', 1), entry('round_completed', 'debate_engine', 9, { round: 1 })];
    renderDossier(dossier({ detail: detail({ trigger_type: 'manual', status: 'investigating', actions: [] }), entries }));
    const timeline = screen.getByRole('region', { name: 'Automation timeline' });

    expect(within(timeline).queryByText('Hands-free · no analyst action')).toBeNull();
    expect(within(timeline).getByText('analyst · soc_lead')).toBeTruthy();
  });

  it('says there is nothing to measure for a case with no audit entries', () => {
    renderDossier(dossier({ entries: [] }));
    expect(within(screen.getByRole('region', { name: 'Automation timeline' })).getByText('No audit entries to measure yet.')).toBeTruthy();
  });
});

describe('Dossier Self-Healing agent', () => {
  it('shows the gate it passed, the playbook it ran and the sandbox boundary', () => {
    renderDossier(dossier());
    const panel = screen.getByRole('region', { name: 'Self-Healing agent' });

    expect(within(panel).getByText('Contained in the sandbox')).toBeTruthy();
    for (const title of ['A verdict was reached', 'The class has containment actions', 'Confidence is at or above the containment floor', 'Every supporting agent is at or above the credibility floor']) {
      expect(within(panel).getByText(title)).toBeTruthy();
    }
    expect(within(panel).getByText('90.0% is at or above the floor 80.0%.')).toBeTruthy();
    expect(within(panel).getByText('Lock account')).toBeTruthy();
    expect(within(panel).getByText('Open an audit')).toBeTruthy();
    expect(within(panel).getByText('“Lock the account the flood came from.”')).toBeTruthy();
    expect(within(panel).getByText('+1.2 s after the verdict')).toBeTruthy();
    expect(within(panel).getAllByText('Simulated')).toHaveLength(2);
    expect(within(panel).getByText('Sandbox boundary: 2 of 2 actions simulated')).toBeTruthy();
  });

  it('releases the containment from the panel', async () => {
    const onChanged = vi.fn();
    renderDossier(dossier(), onChanged);

    fireEvent.click(within(screen.getByRole('region', { name: 'Self-Healing agent' })).getByRole('button', { name: 'Release containment' }));

    await waitFor(() => expect(client.releaseContainment).toHaveBeenCalledWith(ID));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('says why a high-confidence-less case was held, naming the failed check', () => {
    renderDossier(dossier({ detail: detail({ status: 'verdict_reached', verdict_confidence: 0.7, actions: [] }) }));
    const panel = screen.getByRole('region', { name: 'Self-Healing agent' });

    expect(within(panel).getByText('Held by the gate')).toBeTruthy();
    expect(within(panel).getAllByText('Confidence 70.0% is below the floor 80.0%.').length).toBeGreaterThanOrEqual(1);
    expect(within(panel).getByText('No sandbox action was run for this case.')).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: 'Release containment' })).toBeNull();
  });

  it('calls a benign verdict "no action needed", not a refusal', () => {
    renderDossier(dossier({ detail: detail({ status: 'verdict_reached', verdict_class: 'benign', actions: [] }) }));
    expect(within(screen.getByRole('region', { name: 'Self-Healing agent' })).getByText('No action needed')).toBeTruthy();
  });
});

describe('Dossier printable documents', () => {
  const pdfButton = (name: 'Report PDF' | 'Custody PDF') => screen.getByRole('button', { name }) as HTMLButtonElement; // a string name matches the whole label

  it('opens the case report and the chain-of-custody record of a complete case', () => {
    renderDossier(dossier());

    expect(pdfButton('Report PDF').disabled).toBe(false);
    expect(pdfButton('Custody PDF').disabled).toBe(false);
    fireEvent.click(pdfButton('Report PDF'));
    expect(window.location.hash).toBe(`#/report/${ID}`);
    fireEvent.click(pdfButton('Custody PDF'));
    expect(window.location.hash).toBe(`#/custody/${ID}`);
  });

  it('also opens them for a debate that ended in an error (it is complete, with a reason)', () => {
    renderDossier(dossier({ detail: detail({ status: 'error', verdict_class: null, verdict_confidence: null, actions: [], votes: [] }) }));
    expect(pdfButton('Report PDF').disabled).toBe(false);
  });

  it('keeps both closed while the investigation is still running, and says why', () => {
    renderDossier(dossier({ detail: detail({ status: 'investigating', verdict_class: null, verdict_confidence: null, actions: [], votes: [] }) }));

    for (const name of ['Report PDF', 'Custody PDF'] as const) {
      expect(pdfButton(name).disabled).toBe(true);
      expect(pdfButton(name).title).toBe('Opens when the investigation is complete');
    }
  });
});

describe('Dossier evidence storyline', () => {
  it('orders the cited rows by their own time and tallies the hosts', async () => {
    renderDossier(dossier());
    const story = screen.getByRole('region', { name: 'Evidence storyline' });

    await waitFor(() => expect(within(story).getByText('10.0.0.5 ×2')).toBeTruthy());
    expect(client.getRawLog).toHaveBeenCalledTimes(2); // two distinct cited rows, not three citations
    const items = within(story).getAllByRole('listitem');
    expect(items[0].textContent).toContain('row-earl'); // the earlier row comes first
    expect(items[1].textContent).toContain('row-late');
    expect(within(story).getByText('4 m 0 s of activity')).toBeTruthy();
  });

  it('counts a row that could not be read instead of drawing it', async () => {
    client.getRawLog.mockImplementation(async (id: string) => {
      if (id === 'row-early') throw new Error('gone');
      return row('row-late', 300);
    });
    renderDossier(dossier());

    expect(await screen.findByText(/1 cited row could not be read and is left out\./)).toBeTruthy();
  });

  it('has no storyline when the case cited nothing', () => {
    const data = dossier();
    data.citations = { data: { summary: detail().citations, citations: [] } };
    renderDossier(data);

    expect(screen.getByText('No row was cited, so there is no storyline yet.')).toBeTruthy();
    expect(client.getRawLog).not.toHaveBeenCalled();
  });
});
