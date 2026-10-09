import { formatClock, formatRelativeTime, formatTimestamp } from '../lib/format';
import { useNow } from '../lib/use-now';

export interface TimestampProps {
  /** The instant, as the API sent it. null, undefined and "" read as an em dash. */
  iso: string | null | undefined;
  /**
   * relative (default): "3 min ago", with the absolute UTC time in the tooltip.
   * absolute: "2026-10-05 14:03:22 UTC". clock: "14:03:22 UTC". Both keep the relative time in the tooltip.
   * Use absolute or clock for times that are evidence themselves (dataset rows, log lines).
   */
  mode?: 'relative' | 'absolute' | 'clock';
  /** The instant is expected to lie ahead of now (a session expiry): "in 23 h". */
  future?: boolean;
  className?: string;
}

/**
 * One way to show a time. Renders a <time> element whose dateTime is the exact value from the API and whose
 * tooltip carries the other reading. A time with no zone (a dataset row) is shown as written, never converted.
 */
export function Timestamp({ iso, mode = 'relative', future = false, className }: TimestampProps) {
  const now = useNow();
  if (iso === null || iso === undefined || iso === '') return <span className={className}>—</span>;

  const absolute = formatTimestamp(iso);
  const relative = formatRelativeTime(iso, now, { allowFuture: future });
  const text = mode === 'absolute' ? absolute : mode === 'clock' ? formatClock(iso) : relative;
  const title = mode === 'relative' ? absolute : mode === 'clock' ? `${absolute} (${relative})` : relative;

  return (
    <time dateTime={iso} title={title} className={className}>
      {text}
    </time>
  );
}
