import { describe, expect, it } from 'vitest';
import { topByCount } from './tally';

describe('topByCount', () => {
  it('returns the most frequent value and its count', () => {
    expect(topByCount(new Map([['b', 2], ['a', 5], ['c', 1]]))).toEqual({ value: 'a', count: 5 });
  });

  it('breaks a tie with the lexicographically smallest value, whatever the insertion order', () => {
    expect(topByCount(new Map([['u9', 3], ['u2', 3]]))).toEqual({ value: 'u2', count: 3 });
    expect(topByCount(new Map([['u2', 3], ['u9', 3]]))).toEqual({ value: 'u2', count: 3 });
  });

  it('returns null for an empty map', () => {
    expect(topByCount(new Map())).toBeNull();
  });
});
