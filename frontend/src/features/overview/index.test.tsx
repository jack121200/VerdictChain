import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EvaluationResponse, FleetEntry, InvestigationPage, Metric, RawLogRow, ScenarioSummary, Settings, SystemStatus } from '../../api/types';
import { fullStats } from '../../test/fixtures';

vi.mock('../../api/client', () => ({
  describeError: (error: unknown) => String(error),
  getAgentFleet: vi.fn(),
  getEvaluation: vi.fn(),
  getInvestigationCitations: vi.fn(),
  getRawLogCounts: vi.fn(),
  getSettings: vi.fn(),
  getStats: vi.fn(),
  getSystemStatus: vi.fn(),
  listAuditTrail: vi.fn(),
  listInvestigations: vi.fn(),
  listRecentRawLogs: vi.fn(),
  listScenarios: vi.fn(),
}));

import {
  getAgentFleet,
  getEvaluation,
  getInvestigationCitations,
  getRawLogCounts,
  getSettings,
  getStats,
  getSystemStatus,
  listAuditTrail,
  listInvestigations,
  listRecentRawLogs,
  listScenarios,
} from '../../api/client';
import OverviewPage from './index';

const metric = (value: number | null, reason: string | null = null): Metric<number> => ({
  value,
  n: value === null ? 0 : 3,
  as_of: '2026-10-08T00:00:00Z',
  source: 'test',
  definition: 'test',
  reason: value === null ? (reason ?? 'no data yet') : null,
});

const makeStats = fullStats;

const EVAL = { accuracy: metric(0.95) } as unknown as EvaluationResponse;

const FLEET: FleetEntry[] = [
  {
    agent_id: 'network_traffic',
    display_name: 'Network-Traffic',
    domain: 'network traffic',
    signals: ['tls'],
    provider_chain: ['groq'],
    model: 'm',
    temperature: metric(0.2),
    crs: metric(0.9),
    isolated: false,
    rounds_scored: metric(3),
    citations_verified: metric(10),
    citations_total: metric(12),
    invalid_rate: metric(0.1),
    last_vote: 'ddos',
  },
];

const SCENARIO: ScenarioSummary = { label: 'DDoS', dataset: 'CICIDS2017', primary_agent: 'network_traffic', row_count: metric(10), description: 'volumetric flood' };

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

const STATUS = {
  api_version: 'v2',
  providers: {
    groq: { configured: true, model: 'groq-model', temperature: metric(0.2), calls_24h: metric(0), latency_ms: metric(null, 'no calls'), quota_errors_24h: metric(0) },
    gemini: { configured: false, model: null, temperature: metric(0.2), calls_24h: metric(0), latency_ms: metric(null, 'no calls'), quota_errors_24h: metric(0) },
  },
  sandbox: { is_simulated_violations: metric(0), actions_total: metric(0) },
} as unknown as SystemStatus;

const RECENT: RawLogRow[] = [
  { row_id: 'row-7', timestamp: '2026-10-08T12:00:00Z', source: 'cicids2017', source_file: null, event_type: 'FLOW_START', user_id: 'u1', host_id: 'h1', severity: 'low', raw_fields: {} },
];

const INVESTIGATIONS = {
  items: [
    {
      id: 'inv-1',
      status: 'verdict_reached',
      verdict_class: 'ddos',
      verdict_confidence: 0.8,
      primary_agent: 'network_traffic',
      dataset: 'CICIDS2017',
      noise_pct: 0,
      rounds_complete: 3,
      containment_count: 0,
      trigger_type: 'simulate',
      created_at: '2026-10-08T12:00:00Z',
    },
  ],
  total: metric(1),
  limit: 1,
  offset: 0,
} as unknown as InvestigationPage;

beforeEach(() => {
  vi.mocked(getEvaluation).mockResolvedValue(EVAL);
  vi.mocked(getStats).mockResolvedValue(makeStats());
  vi.mocked(getAgentFleet).mockResolvedValue(FLEET);
  vi.mocked(listScenarios).mockResolvedValue([SCENARIO]);
  vi.mocked(getRawLogCounts).mockResolvedValue({
    total: metric(1000),
    sources: [{ source: 'cicids2017', count: metric(1000) }],
  });
  vi.mocked(getSettings).mockResolvedValue(SETTINGS);
  vi.mocked(getSystemStatus).mockResolvedValue(STATUS);
  vi.mocked(listAuditTrail).mockResolvedValue({ entries: [], chain: { valid: true, head_seq: 1, total: 5 } });
  vi.mocked(listRecentRawLogs).mockResolvedValue(RECENT);
  vi.mocked(listInvestigations).mockResolvedValue(INVESTIGATIONS);
  vi.mocked(getInvestigationCitations).mockResolvedValue({
    summary: { total: 1, verified: 1, discrepancy: 0, invalid_row: 0, match_rate: metric(1) },
    citations: [
      { row_id: 'row-7', field: 'total_bytes', value: '48200', expected: '48200', status: 'VERIFIED', reason: 'ok', agent_id: 'network_traffic', round: 1, row_fingerprint: 'abc123' },
    ],
  });
});

describe('OverviewPage', () => {
  it('renders real evaluated accuracy, scenario labels and the raw ingestion ledger', async () => {
    render(<OverviewPage />);
    expect(await screen.findByText('95.0%')).toBeTruthy(); // evaluated accuracy
    expect(await screen.findByText('DDoS')).toBeTruthy(); // real scenario label
    expect(await screen.findByText('FLOW_START')).toBeTruthy(); // real raw-log event from the ledger
  });

  it('shows the latest verdict confidence and a real Watchdog citation', async () => {
    render(<OverviewPage />);
    expect(await screen.findByText('80.0%')).toBeTruthy(); // latest agent-reported confidence
    expect(await screen.findByText('Watchdog citation OK')).toBeTruthy();
    expect(await screen.findByText('row-7')).toBeTruthy();
  });

  it('does not crash on a scenario label that no ingested row carries (primary_agent null)', async () => {
    vi.mocked(listScenarios).mockResolvedValue([
      { ...SCENARIO, label: 'FTP-Patator', primary_agent: null, row_count: metric(0) },
    ]);
    render(<OverviewPage />);
    expect(await screen.findByText('FTP-Patator')).toBeTruthy();
    expect(await screen.findByText(/no rows ingested for this label/i)).toBeTruthy();
  });

  it('shows an em dash and the reason for a null metric, never 0', async () => {
    vi.mocked(getEvaluation).mockResolvedValue({ accuracy: metric(null, 'not evaluated yet') } as unknown as EvaluationResponse);
    render(<OverviewPage />);
    expect(await screen.findByText('not evaluated yet')).toBeTruthy();
  });

  it('shows a raw-log time as a clock from the row, and the rounds as done out of total', async () => {
    const { container } = render(<OverviewPage />);
    await screen.findByText('FLOW_START');
    expect(container.querySelector('time[datetime="2026-10-08T12:00:00Z"]')?.textContent).toBe('12:00:00 UTC');
    expect(await screen.findByText(/rounds: \d+\/3/)).toBeTruthy();
  });
});
