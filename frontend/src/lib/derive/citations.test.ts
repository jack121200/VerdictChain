import { describe, expect, it } from 'vitest';
import type { Citation } from '../../api/types';
import { mostCitedValue as dashboardMostCited } from '../../features/dashboard/derive';
import { earliestCitedTimestamp, mostCitedValue as debateMostCited } from '../../features/debate/derive';
import { attributionFromCitations } from '../../features/investigations/derive';
import { isVerifiedClaim } from './citations';

function cite(field: string, value: string | null, status: Citation['status'] = 'VERIFIED'): Citation {
  return {
    row_id: 'r',
    field,
    value,
    expected: null,
    status,
    reason: status === 'VERIFIED' ? 'ok' : 'value_mismatch',
    agent_id: 'access_log',
    round: 1,
    row_fingerprint: 'f',
  } as Citation;
}

// An agent that hallucinates cites real rows with values the rows do not hold.
const drill: Citation[] = [
  cite('user_id', 'stub-fabricated-value', 'DISCREPANCY'),
  cite('user_id', 'stub-fabricated-value', 'DISCREPANCY'),
  cite('user_id', 'stub-fabricated-value', 'DISCREPANCY'),
  cite('user_id', 'AAW0353'),
  cite('user_id', 'AIM0627'),
  cite('host_id', 'bad-host', 'INVALID_ROW'),
];

describe('isVerifiedClaim', () => {
  it('accepts only VERIFIED citations, and citations that carry no status', () => {
    expect(isVerifiedClaim({ status: 'VERIFIED' })).toBe(true);
    expect(isVerifiedClaim({})).toBe(true);
    expect(isVerifiedClaim({ status: 'DISCREPANCY' })).toBe(false);
    expect(isVerifiedClaim({ status: 'INVALID_ROW' })).toBe(false);
  });
});

describe('attribution uses only citations the Watchdog verified', () => {
  it('the dashboard banner never names a fabricated value as the subject', () => {
    // Three fabricated citations outnumber the verified ones, and must still lose.
    expect(dashboardMostCited(drill, 'user_id')).toBe('AAW0353');
    expect(dashboardMostCited(drill, 'host_id')).toBeNull();
  });

  it('the debate room subject and trigger time ignore discrepant and invalid citations', () => {
    expect(debateMostCited(drill, 'user_id')).toBe('AAW0353');
    expect(debateMostCited(drill, 'host_id')).toBeNull();
    const times = [cite('timestamp', '2010-01-01T00:00:00Z', 'DISCREPANCY'), cite('timestamp', '2010-03-01T00:00:00Z')];
    expect(earliestCitedTimestamp(times)).toBe('2010-03-01T00:00:00Z');
  });

  it('the dossier subject, host and earliest time ignore them too', () => {
    const attribution = attributionFromCitations([...drill, cite('timestamp', '2010-01-01T00:00:00Z', 'INVALID_ROW')]);
    expect(attribution.subject).toEqual({ value: 'AAW0353', count: 1 });
    expect(attribution.host).toBeNull();
    expect(attribution.earliestCitedTimestamp).toBeNull();
    expect(attribution.citationCount).toBe(7);
  });

  it('is null, not a guess, when nothing was verified', () => {
    const none = [cite('user_id', 'x', 'DISCREPANCY'), cite('user_id', 'y', 'INVALID_ROW')];
    expect(dashboardMostCited(none, 'user_id')).toBeNull();
    expect(debateMostCited(none, 'user_id')).toBeNull();
    expect(attributionFromCitations(none).subject).toBeNull();
  });
});
