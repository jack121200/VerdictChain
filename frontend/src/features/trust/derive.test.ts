import { describe, expect, it } from 'vitest';
import type { CredibilityRow, FleetEntry, InvestigatorId, Metric } from '../../api/types';
import {
  agentDelta,
  flaggedAgents,
  isolationGauge,
  latestChange,
  overallDelta,
  type HistoryMap,
} from './derive';

function metric(value: number | null): Metric<number> {
  return { value, n: value === null ? 0 : 1, as_of: '2026-10-05T00:00:00Z', source: 't', definition: 'd', reason: value === null ? 'none' : null };
}

function row(agentId: InvestigatorId, round: number, before: number, after: number, rate: number, at: string): CredibilityRow {
  return {
    investigation_id: 'inv',
    agent_id: agentId,
    round,
    crs_before: before,
    crs_after: after,
    verification_match_rate: rate,
    isolated: false,
    created_at: at,
  };
}

function fleetEntry(agentId: InvestigatorId, crs: number | null, isolated = false): FleetEntry {
  return {
    agent_id: agentId,
    display_name: agentId,
    domain: 'd',
    signals: [],
    provider_chain: [],
    model: null,
    temperature: metric(0.2),
    crs: metric(crs),
    isolated,
    rounds_scored: metric(crs === null ? 0 : 1),
    citations_verified: metric(0),
    citations_total: metric(0),
    invalid_rate: metric(0),
    last_vote: null,
  };
}

const empty: HistoryMap = { network_traffic: [], access_log: [], endpoint_behavior: [] };

describe('trust derivations', () => {
  it('agentDelta returns the newest row change, or null when empty', () => {
    expect(agentDelta([])).toBeNull();
    expect(
      agentDelta([
        row('network_traffic', 1, 0.5, 0.6, 1, '2026-10-01T00:00:00Z'),
        row('network_traffic', 2, 0.6, 0.72, 1, '2026-10-02T00:00:00Z'),
      ]),
    ).toBeCloseTo(0.12, 6);
  });

  it('overallDelta averages per-agent newest deltas and reports n', () => {
    const histories: HistoryMap = {
      network_traffic: [row('network_traffic', 1, 0.5, 0.6, 1, '2026-10-01T00:00:00Z')],
      access_log: [row('access_log', 1, 0.5, 0.4, 0.5, '2026-10-01T00:00:00Z')],
      endpoint_behavior: [],
    };
    const result = overallDelta(histories);
    expect(result.n).toBe(2);
    expect(result.value).toBeCloseTo((0.1 + -0.1) / 2, 6);
    expect(overallDelta(empty)).toEqual({ value: null, n: 0 });
  });

  it('flaggedAgents lists agents with a discrepancy in the last window', () => {
    const histories: HistoryMap = {
      network_traffic: [row('network_traffic', 1, 0.5, 0.6, 1, 'a')],
      access_log: [row('access_log', 1, 0.5, 0.4, 0.8, 'a')],
      endpoint_behavior: [],
    };
    expect(flaggedAgents(histories)).toEqual(['access_log']);
  });

  it('isolationGauge finds the lowest CrS and its margin to the threshold', () => {
    const fleet = [fleetEntry('network_traffic', 0.9), fleetEntry('access_log', 0.6), fleetEntry('endpoint_behavior', null)];
    const gauge = isolationGauge(fleet, 0.3);
    expect(gauge.minAgent).toBe('access_log');
    expect(gauge.minCrs).toBeCloseTo(0.6, 6);
    expect(gauge.margin).toBeCloseTo(0.3, 6);
  });

  it('latestChange picks the most recent credibility_log row across agents', () => {
    const histories: HistoryMap = {
      network_traffic: [row('network_traffic', 1, 0.5, 0.6, 1, '2026-10-01T00:00:00Z')],
      access_log: [row('access_log', 2, 0.5, 0.55, 0.9, '2026-10-03T00:00:00Z')],
      endpoint_behavior: [],
    };
    const change = latestChange(histories);
    expect(change?.agent).toBe('access_log');
    expect(change?.round).toBe(2);
    expect(latestChange(empty)).toBeNull();
  });
});
