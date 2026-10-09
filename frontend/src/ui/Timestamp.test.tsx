import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from './Timestamp';

const NOW = Date.parse('2026-10-09T12:00:00Z');
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Timestamp', () => {
  it('shows relative text with the exact time in dateTime and the absolute UTC time in the tooltip', () => {
    const iso = minutesAgo(3);
    render(<Timestamp iso={iso} />);
    const element = screen.getByText('3 min ago');
    expect(element.tagName).toBe('TIME');
    expect(element.getAttribute('datetime')).toBe(iso);
    expect(element.getAttribute('title')).toBe('2026-10-09 11:57:00 UTC');
  });

  it('can show the absolute time or the clock, keeping the relative time in the tooltip', () => {
    const iso = '2026-10-09T11:57:20.5Z';
    const { rerender } = render(<Timestamp iso={iso} mode="absolute" />);
    expect(screen.getByText('2026-10-09 11:57:20 UTC').getAttribute('title')).toBe('2 min ago');
    rerender(<Timestamp iso={iso} mode="clock" />);
    expect(screen.getByText('11:57:20 UTC').getAttribute('title')).toBe('2026-10-09 11:57:20 UTC (2 min ago)');
  });

  it('reads an expected future time as "in ..."', () => {
    render(<Timestamp iso="2026-10-10T11:00:00Z" future />);
    expect(screen.getByText('in 23 h')).toBeTruthy();
  });

  it('shows an em dash and no <time> element when there is no value', () => {
    const { container } = render(<Timestamp iso={null} />);
    expect(container.textContent).toBe('—');
    expect(container.querySelector('time')).toBeNull();
  });

  it('shows a dataset time with no zone exactly as written', () => {
    render(<Timestamp iso="2010-08-17 03:12:00" mode="absolute" />);
    expect(screen.getByText('2010-08-17 03:12:00')).toBeTruthy();
  });

  it('re-reads the clock on its own as time passes', () => {
    render(<Timestamp iso={minutesAgo(2)} />);
    expect(screen.getByText('2 min ago')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(screen.getByText('4 min ago')).toBeTruthy();
  });
});
