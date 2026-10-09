/**
 * Typed test fixtures shaped exactly like the real API. They are typed with the API types, so when a type
 * changes to match the backend (scripts/contract-check.mjs proves it does), every fixture that is out of
 * date stops compiling. That is the point: hand-made mocks must not be able to drift from the real shape.
 */
import type { Metric, StatsResponse } from '../api/types';

export function metric(value: number | null, reason: string | null = null): Metric<number> {
  return {
    value,
    n: value === null ? 0 : 1,
    as_of: '2026-10-08T00:00:00Z',
    source: 'test',
    definition: 'test value',
    reason: value === null ? (reason ?? 'no data yet') : null,
  };
}

/** A complete GET /stats payload. Override any part. */
export function fullStats(overrides: Partial<StatsResponse> = {}): StatsResponse {
  return {
    active: metric(0),
    stale: metric(0),
    threats_24h: metric(0),
    insider_count: metric(0),
    contained: metric(0),
    by_status: { investigating: metric(0), verdict_reached: metric(0), ambiguous: metric(0), contained: metric(0), error: metric(0) },
    by_verdict_class: { ddos: metric(0), benign: metric(0) },
    mean_agent_confidence: metric(0.5),
    mean_crs: metric(0.9),
    citations: {
      total: metric(50),
      verified: metric(48),
      discrepancy: metric(1),
      invalid_row: metric(1),
      verified_rate: metric(0.96),
      invalid_rate: metric(0.04),
    },
    chain: { valid: true, entries: metric(10), head_seq: metric(10) },
    watchdog: { checks_total: metric(8), citations_checked: metric(50), discrepancies: metric(1), isolations: metric(0) },
    self_healing: { actions_total: metric(14), non_simulated: metric(0), simulated_share: metric(1) },
    feedback: { total: metric(0), confirmed: metric(0), false_positive: metric(0), agreement_rate: metric(null) },
    brier: metric(null),
    latency: { definition: 'audit investigation_started to verdict_reached', mean_seconds: metric(null) },
    generated_at: '2026-10-08T00:00:00Z',
    ...overrides,
  };
}
