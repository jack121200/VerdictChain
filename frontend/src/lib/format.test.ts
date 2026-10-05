import { describe, expect, it } from 'vitest';
import { formatCount, formatDuration, formatNumber, formatPercent, formatTimestamp, shortId } from './format';

describe('format', () => {
  it('shows integers with separators and returns an em dash for non-finite input', () => {
    expect(formatCount(1234)).toBe('1,234');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(Number.NaN)).toBe('—');
  });

  it('fixes decimals and renders ratios as percentages', () => {
    expect(formatNumber(0.15, 2)).toBe('0.15');
    expect(formatPercent(0.5, 1)).toBe('50.0%');
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('reads sub-millisecond durations as a bound, not as zero', () => {
    expect(formatDuration(0.4)).toBe('<1 ms');
    expect(formatDuration(250)).toBe('250 ms');
    expect(formatDuration(2500)).toBe('2.5 s');
    expect(formatDuration(125_000)).toBe('2 m 5 s');
    expect(formatDuration(Number.NaN)).toBe('—');
  });

  it('formats timestamps in UTC and returns unparseable input unchanged', () => {
    expect(formatTimestamp('2026-10-05T14:03:22Z')).toBe('2026-10-05 14:03:22 UTC');
    expect(formatTimestamp('not a date')).toBe('not a date');
  });

  it('shortens long ids and keeps short ones', () => {
    expect(shortId('9f4d2c1a-aaaa-bbbb')).toBe('9f4d2c1a');
    expect(shortId('abc')).toBe('abc');
  });
});
