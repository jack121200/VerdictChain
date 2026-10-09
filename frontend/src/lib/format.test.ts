import { describe, expect, it } from 'vitest';
import {
  cssPercent,
  formatClock,
  formatCount,
  formatCountNoun,
  formatDuration,
  formatMaybeCount,
  formatNumber,
  formatOutOf,
  formatPercent,
  formatPercentPoints,
  formatRelativeTime,
  formatSeq,
  formatSignedPercent,
  formatTimestamp,
  hasTimeZone,
  percentPoints,
  shortId,
} from './format';

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
    expect(formatTimestamp('2026-10-05T14:03:22.339773Z')).toBe('2026-10-05 14:03:22 UTC');
    expect(formatTimestamp('2026-10-05T16:03:22+02:00')).toBe('2026-10-05 14:03:22 UTC');
    expect(formatTimestamp('not a date')).toBe('not a date');
  });

  it('shortens long ids and keeps short ones', () => {
    expect(shortId('9f4d2c1a-aaaa-bbbb')).toBe('9f4d2c1a');
    expect(shortId('abc')).toBe('abc');
  });
});

describe('counts and ids', () => {
  it('reads a missing count as an em dash and a real zero as 0', () => {
    expect(formatMaybeCount(null)).toBe('—');
    expect(formatMaybeCount(undefined)).toBe('—');
    expect(formatMaybeCount(0)).toBe('0');
    expect(formatMaybeCount(12_345)).toBe('12,345');
  });

  it('puts the right noun after a count', () => {
    expect(formatCountNoun(1, 'round')).toBe('1 round');
    expect(formatCountNoun(0, 'round')).toBe('0 rounds');
    expect(formatCountNoun(1200, 'row')).toBe('1,200 rows');
    expect(formatCountNoun(2, 'entry', 'entries')).toBe('2 entries');
  });

  it('writes done out of total and dashes a missing side', () => {
    expect(formatOutOf(3, 3)).toBe('3/3');
    expect(formatOutOf(2, null)).toBe('2/—');
    expect(formatOutOf(undefined, 3)).toBe('—/3');
  });

  it('writes a sequence number as an identifier with no separators', () => {
    expect(formatSeq(1109)).toBe(['#', '1109'].join(''));
    expect(formatSeq(7)).toBe('#7');
    expect(formatSeq(Number.NaN)).toBe('—');
  });
});

describe('percentages', () => {
  it('signs a change in a ratio', () => {
    expect(formatSignedPercent(0.032)).toBe('+3.2%');
    expect(formatSignedPercent(-0.01)).toBe('-1.0%');
    expect(formatSignedPercent(0)).toBe('+0.0%');
    expect(formatSignedPercent(Number.NaN)).toBe('—');
  });

  it('formats a value that is already in percent units', () => {
    expect(formatPercentPoints(30)).toBe('30%');
    expect(formatPercentPoints(12.5, 1)).toBe('12.5%');
    expect(formatPercentPoints(Number.NaN)).toBe('—');
  });

  it('clamps a ratio into a CSS width and into whole points', () => {
    expect(cssPercent(0.256)).toBe('25.6%');
    expect(cssPercent(0.1 + 0.2)).toBe('30%');
    expect(cssPercent(1.7)).toBe('100%');
    expect(cssPercent(-0.2)).toBe('0%');
    expect(cssPercent(Number.NaN)).toBe('0%');
    expect(percentPoints(0.256)).toBe(26);
    expect(percentPoints(2)).toBe(100);
  });
});

describe('time zones and clocks', () => {
  it('knows which strings carry a zone', () => {
    expect(hasTimeZone('2026-10-05T14:03:22Z')).toBe(true);
    expect(hasTimeZone('2026-10-05T14:03:22.5+05:30')).toBe(true);
    expect(hasTimeZone('2026-10-05T14:03:22-0500')).toBe(true);
    expect(hasTimeZone('2010-08-17 03:12:00')).toBe(false);
    expect(hasTimeZone('2026-10-05')).toBe(false);
  });

  it('never shifts a dataset time that has no zone', () => {
    expect(formatTimestamp('2010-08-17 03:12:00')).toBe('2010-08-17 03:12:00');
    expect(formatClock('2010-08-17 03:12:00')).toBe('03:12:00');
    expect(formatClock('no clock here')).toBe('no clock here');
  });

  it('shows the UTC clock of a real instant', () => {
    expect(formatClock('2026-10-05T14:03:22.339773Z')).toBe('14:03:22 UTC');
  });
});

describe('formatRelativeTime', () => {
  const NOW = Date.parse('2026-10-09T12:00:00Z');
  const ago = (ms: number) => new Date(NOW - ms).toISOString();

  it('reads recent past as just now, minutes, hours and days', () => {
    expect(formatRelativeTime(ago(5_000), NOW)).toBe('just now');
    expect(formatRelativeTime(ago(59_000), NOW)).toBe('just now');
    expect(formatRelativeTime(ago(3 * 60_000 + 20_000), NOW)).toBe('3 min ago');
    expect(formatRelativeTime(ago(5 * 3_600_000 + 60_000), NOW)).toBe('5 h ago');
    expect(formatRelativeTime(ago(2 * 86_400_000 + 3_600_000), NOW)).toBe('2 d ago');
  });

  it('falls back to the UTC date after 30 days', () => {
    expect(formatRelativeTime('2026-08-01T10:00:00Z', NOW)).toBe('2026-08-01');
  });

  it('absorbs a small clock difference but shows a large future time as absolute', () => {
    expect(formatRelativeTime(new Date(NOW + 90_000).toISOString(), NOW)).toBe('just now');
    expect(formatRelativeTime('2026-10-09T13:00:00Z', NOW)).toBe('2026-10-09 13:00:00 UTC');
  });

  it('reads an expected future time as "in ..."', () => {
    const opts = { allowFuture: true };
    expect(formatRelativeTime(new Date(NOW + 30_000).toISOString(), NOW, opts)).toBe('in <1 min');
    expect(formatRelativeTime(new Date(NOW + 12 * 60_000 + 5_000).toISOString(), NOW, opts)).toBe('in 12 min');
    expect(formatRelativeTime(new Date(NOW + 23 * 3_600_000 + 5_000).toISOString(), NOW, opts)).toBe('in 23 h');
    expect(formatRelativeTime(new Date(NOW + 3 * 86_400_000 + 5_000).toISOString(), NOW, opts)).toBe('in 3 d');
  });

  it('returns input without a zone or a parseable date unchanged', () => {
    expect(formatRelativeTime('2010-08-17 03:12:00', NOW)).toBe('2010-08-17 03:12:00');
    expect(formatRelativeTime('not a date', NOW)).toBe('not a date');
    expect(formatRelativeTime('2026-13-45T99:00:00Z', NOW)).toBe('2026-13-45T99:00:00Z');
  });
});
