import { describe, expect, it } from 'vitest';
import type { Citation } from '../../api/types';
import { mostCitedValue } from './derive';

function cite(field: string, value: string | null, status: Citation['status'] = 'VERIFIED'): Citation {
  return { row_id: `${field}-${value}-${Math.abs(String(value).length)}`, field, value, expected: value, status, reason: 'ok', agent_id: 'access_log', round: 1, row_fingerprint: null };
}

const repeat = (count: number, make: () => Citation): Citation[] => Array.from({ length: count }, make);

describe('mostCitedValue (dashboard)', () => {
  it('picks the most-cited VERIFIED value', () => {
    const citations = [...repeat(3, () => cite('user_id', 'u-7')), ...repeat(1, () => cite('user_id', 'u-2'))];
    expect(mostCitedValue(citations, 'user_id')).toBe('u-7');
  });

  it('breaks a 3-3 tie with the lexicographically smallest value, in either arrival order', () => {
    const a = repeat(3, () => cite('user_id', 'u-9'));
    const b = repeat(3, () => cite('user_id', 'u-2'));
    expect(mostCitedValue([...a, ...b], 'user_id')).toBe('u-2');
    expect(mostCitedValue([...b, ...a], 'user_id')).toBe('u-2');
  });

  it('ignores DISCREPANCY and INVALID_ROW claims even when there are more of them', () => {
    const citations = [
      ...repeat(5, () => cite('host_id', 'fake-host', 'DISCREPANCY')),
      ...repeat(2, () => cite('host_id', 'bad-host', 'INVALID_ROW')),
      cite('host_id', 'real-host'),
    ];
    expect(mostCitedValue(citations, 'host_id')).toBe('real-host');
  });

  it('returns null when nothing verified names the field', () => {
    expect(mostCitedValue([cite('user_id', 'x', 'DISCREPANCY')], 'user_id')).toBeNull();
    expect(mostCitedValue([], 'user_id')).toBeNull();
  });
});
