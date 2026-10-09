import { describe, expect, it } from 'vitest';
import type { Citation } from '../../api/types';
import { attributionFromCitations } from './derive';

function cite(field: string, value: string | null, status: Citation['status'] = 'VERIFIED'): Citation {
  return { row_id: 'r', field, value, expected: value, status, reason: 'ok', agent_id: 'access_log', round: 1, row_fingerprint: null };
}

const repeat = (count: number, make: () => Citation): Citation[] => Array.from({ length: count }, make);

describe('attributionFromCitations', () => {
  it('picks the most-cited VERIFIED subject and host with their counts', () => {
    const result = attributionFromCitations([
      ...repeat(3, () => cite('user_id', 'AAW0353')),
      cite('user_id', 'AIM0627'),
      ...repeat(2, () => cite('host_id', 'PC-4421')),
    ]);
    expect(result.subject).toEqual({ value: 'AAW0353', count: 3 });
    expect(result.host).toEqual({ value: 'PC-4421', count: 2 });
    expect(result.citationCount).toBe(6);
  });

  it('breaks a 3-3 tie with the lexicographically smallest subject and host, in either arrival order', () => {
    const subjects = [...repeat(3, () => cite('user_id', 'SCP0130')), ...repeat(3, () => cite('user_id', 'AIM0627'))];
    const hosts = [...repeat(3, () => cite('host_id', 'PC-9')), ...repeat(3, () => cite('host_id', 'PC-3'))];
    for (const citations of [[...subjects, ...hosts], [...subjects].reverse().concat([...hosts].reverse())]) {
      const result = attributionFromCitations(citations);
      expect(result.subject).toEqual({ value: 'AIM0627', count: 3 });
      expect(result.host).toEqual({ value: 'PC-3', count: 3 });
    }
  });

  it('ignores values an agent only claimed (DISCREPANCY, INVALID_ROW)', () => {
    const result = attributionFromCitations([
      ...repeat(4, () => cite('user_id', 'stub-fabricated-value', 'DISCREPANCY')),
      cite('user_id', 'SCP0130'),
    ]);
    expect(result.subject).toEqual({ value: 'SCP0130', count: 1 });
  });

  it('takes the earliest VERIFIED cited timestamp', () => {
    const result = attributionFromCitations([
      cite('timestamp', '2010-09-23T08:14:00Z'),
      cite('timestamp', '2010-09-22T01:00:00Z'),
      cite('timestamp', '2009-01-01T00:00:00Z', 'DISCREPANCY'),
    ]);
    expect(result.earliestCitedTimestamp).toBe('2010-09-22T01:00:00Z');
  });
});
