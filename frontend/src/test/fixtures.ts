/**
 * Typed test fixtures shaped exactly like the real API. They are typed with the API types, so when a type
 * changes to match the backend (scripts/contract-check.mjs proves it does), every fixture that is out of
 * date stops compiling. That is the point: hand-made mocks must not be able to drift from the real shape.
 */
import type {
  AllowanceStatus,
  EvaluationResponse,
  EvaluationSource,
  Metric,
  PredictedClass,
  StatsResponse,
  VerdictClass,
} from '../api/types';

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

/** What OpenAI allows the key. With no argument: no reading yet (every number null with its reason). */
export function allowance(reading: { requests: [number, number]; tokens: [number, number] } | null = null, heldUntil: string | null = null): AllowanceStatus {
  const none = 'OpenAI has not answered yet, so there is no reading';
  return {
    requests_left: metric(reading ? reading.requests[0] : null, none),
    requests_allowed: metric(reading ? reading.requests[1] : null, none),
    tokens_left: metric(reading ? reading.tokens[0] : null, none),
    tokens_allowed: metric(reading ? reading.tokens[1] : null, none),
    held_until: heldUntil,
  };
}

const CLASSES: readonly VerdictClass[] = [
  'ddos',
  'port_scan',
  'brute_force',
  'botnet_c2',
  'insider_file_exfiltration',
  'insider_logon_anomaly',
  'benign',
];

/**
 * A complete GET /evaluation payload for `source`. With no scored runs (scored = 0) every rate is null with the
 * reason the API gives and the matrix is all zeros; with scored runs it holds a small realistic result:
 * 10 scored, 8 correct, 1 miss (a port scan read as DDoS) and 1 abstention.
 */
export function evaluationFixture(
  source: EvaluationSource = 'model',
  scored: number | null = 0,
  elsewhere: { stub?: number; model?: number; mixed?: number } = {},
): EvaluationResponse {
  const none = 'no labelled verdicts yet';
  const rate = (value: number | null, n: number, reason: string | null = none): Metric<number> => ({
    value,
    n: value === null ? 0 : n,
    as_of: '2026-10-11T00:00:00Z',
    source: '/evaluation',
    definition: 'definition of the rate',
    reason: value === null ? reason : null,
  });
  const has = (scored ?? 0) > 0;
  const n = scored ?? 0;
  const cols: PredictedClass[] = [...CLASSES, 'ambiguous', 'unclassified'];
  const hits: Record<string, number> = has ? { 'ddos|ddos': 5, 'botnet_c2|botnet_c2': 3, 'port_scan|ddos': 1, 'benign|ambiguous': 1 } : {};
  const emptyReason = has ? null : `no ${source} runs scored yet; ${elsewhere.stub ?? 0} scored run(s) from other sources are not counted here`;
  const headline = (value: number): Metric<number> => rate(has ? value : null, n, emptyReason ?? none);
  const part = (origin: 'model' | 'stub' | 'mixed'): { scored: Metric<number>; accuracy: Metric<number> } => {
    const count = elsewhere[origin] ?? (origin === source && has ? n : 0);
    return {
      scored: { value: count, n: count, as_of: '2026-10-11T00:00:00Z', source: '/evaluation', definition: 'scored runs of this source', reason: null },
      accuracy: rate(count > 0 ? 0.8 : null, count),
    };
  };
  return {
    source,
    by_source: { model: part('model'), stub: part('stub'), mixed: part('mixed') },
    labelled: { value: n + 2, n: n + 2, as_of: '2026-10-11T00:00:00Z', source: '/evaluation', definition: 'labelled investigations', reason: null },
    scored: { value: n, n, as_of: '2026-10-11T00:00:00Z', source: '/evaluation', definition: 'labelled investigations that reached a verdict', reason: null },
    accuracy: headline(0.8),
    acceptable_accuracy: headline(0.9),
    family_accuracy: headline(0.9),
    abstain_rate: headline(0.1),
    per_class: CLASSES.map((verdict_class) => ({
      verdict_class,
      precision: rate(has && verdict_class === 'ddos' ? 5 / 6 : null, 6, `no investigation was given the verdict ${verdict_class}`),
      recall: rate(has && verdict_class === 'ddos' ? 1 : null, 5, `no labelled investigation expects ${verdict_class}`),
      f1: rate(has && verdict_class === 'ddos' ? 0.91 : null, 11, `no investigation predicted or expected as ${verdict_class}`),
    })),
    confusion_matrix: {
      rows: [...CLASSES],
      cols,
      cells: CLASSES.flatMap((actual) =>
        cols.map((predicted) => ({
          actual,
          predicted,
          count: { value: hits[`${actual}|${predicted}`] ?? 0, n, as_of: '2026-10-11T00:00:00Z', source: '/evaluation', definition: 'count', reason: null },
        })),
      ),
    },
    by_noise: ([0, 15, 30] as const).map((noise_pct) => ({
      noise_pct,
      accuracy: headline(noise_pct === 0 ? 0.9 : 0.7),
      acceptable_accuracy: headline(0.9),
      family_accuracy: headline(0.9),
      abstain_rate: headline(0.1),
    })),
    mapping: [
      { scenario_label: 'DDoS', expected_class: 'ddos', accepted_classes: [] },
      { scenario_label: 'insider_scenario_1', expected_class: 'insider_logon_anomaly', accepted_classes: ['insider_file_exfiltration'] },
    ],
    mapping_status: 'insider scenarios 1 to 3 are mapped from the event types in the CERT r4.2 answer files; each also accepts the other insider class',
    generated_at: '2026-10-11T00:00:00Z',
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
    by_status: { queued: metric(0), investigating: metric(0), verdict_reached: metric(0), ambiguous: metric(0), contained: metric(0), error: metric(0) },
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
    automation: {
      cases: metric(0),
      auto_started: metric(0),
      auto_share: metric(null, 'no investigation was accepted in the last 24 hours'),
      hands_free_contained: metric(0),
      median_seconds_to_verdict: metric(null, 'no investigation reached a verdict in the last 24 hours'),
      median_seconds_verdict_to_action: metric(null, 'no investigation was contained in the last 24 hours'),
    },
    generated_at: '2026-10-08T00:00:00Z',
    ...overrides,
  };
}
