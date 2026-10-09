/** Display formatting. Every function returns an em dash for values that are not finite numbers. */

const EM_DASH = '—';

const COUNT_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Integer with thousands separators: 1234 -> "1,234". */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return EM_DASH;
  return COUNT_FORMAT.format(value);
}

/** formatCount for a value that may be missing: null and undefined read as an em dash, never as 0. */
export function formatMaybeCount(value: number | null | undefined): string {
  return value === null || value === undefined ? EM_DASH : formatCount(value);
}

/** A count with its noun: formatCountNoun(1, 'round') -> "1 round", formatCountNoun(3, 'round') -> "3 rounds". */
export function formatCountNoun(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}

/** "done/total" with each side formatted; a missing side is an em dash: formatOutOf(3, 3) -> "3/3". */
export function formatOutOf(done: number | null | undefined, total: number | null | undefined): string {
  return `${formatMaybeCount(done)}/${formatMaybeCount(total)}`;
}

/** A sequence number as an identifier: a hash sign and the plain integer, with no thousands separators. */
export function formatSeq(seq: number): string {
  if (!Number.isFinite(seq)) return EM_DASH;
  return `#${Math.trunc(seq)}`;
}

/** Fixed decimals: formatNumber(0.15, 2) -> "0.15". */
export function formatNumber(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return EM_DASH;
  return value.toFixed(decimals);
}

/** A ratio in 0..1 as a percentage: formatPercent(0.5, 1) -> "50.0%". */
export function formatPercent(ratio: number, decimals = 1): string {
  if (!Number.isFinite(ratio)) return EM_DASH;
  return `${(ratio * 100).toFixed(decimals)}%`;
}

/** A change in a ratio, always signed: formatSignedPercent(0.032) -> "+3.2%", formatSignedPercent(-0.01) -> "-1.0%". */
export function formatSignedPercent(ratio: number, decimals = 1): string {
  if (!Number.isFinite(ratio)) return EM_DASH;
  const text = (ratio * 100).toFixed(decimals);
  return ratio >= 0 ? `+${text}%` : `${text}%`;
}

/** A value the API already reports in percent units (noise_pct is 30 for 30 %): formatPercentPoints(30) -> "30%". */
export function formatPercentPoints(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return EM_DASH;
  return `${value.toFixed(decimals)}%`;
}

function clampRatio(ratio: number): number {
  return Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
}

/** A ratio as a CSS width or offset, clamped to the track: cssPercent(0.256) -> "25.6%". Not display text. */
export function cssPercent(ratio: number): string {
  return `${Math.round(clampRatio(ratio) * 10_000) / 100}%`;
}

/** A ratio as whole percentage points for aria-valuenow: percentPoints(0.256) -> 26. */
export function percentPoints(ratio: number): number {
  return Math.round(clampRatio(ratio) * 100);
}

/**
 * Milliseconds as a short duration. Sub-millisecond values read "<1 ms", so a measured
 * latency never shows a made-up figure.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return EM_DASH;
  if (ms < 1) return '<1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes} m ${seconds} s`;
}

/** Ends with Z or a numeric offset. A string with neither names no zone, so it cannot be converted to UTC. */
const ZONE_SUFFIX = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/** True when the ISO string carries its own time zone. Dataset times such as "2010-08-17 03:12:00" do not. */
export function hasTimeZone(iso: string): boolean {
  return ZONE_SUFFIX.test(iso.trim());
}

function parseInstant(iso: string): number | null {
  if (!hasTimeZone(iso)) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * ISO timestamp as "2026-10-05 14:03:22 UTC". Input that is not a parseable instant with a zone is returned
 * unchanged, never guessed (a dataset time with no zone would otherwise be shifted by the browser's zone).
 */
export function formatTimestamp(iso: string): string {
  const ms = parseInstant(iso);
  if (ms === null) return iso;
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`;
}

/** Time of day only, for log-style lines: "14:03:22 UTC". A time with no zone keeps the clock it was written with. */
export function formatClock(iso: string): string {
  const ms = parseInstant(iso);
  if (ms === null) {
    const written = /(\d{2}:\d{2}:\d{2})/.exec(iso);
    return written ? written[1] : iso;
  }
  const date = new Date(ms);
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** Server and browser clocks may differ a little: an event this far ahead still reads as "just now". */
const CLOCK_SKEW_MS = 2 * MINUTE_MS;
const RELATIVE_LIMIT_DAYS = 30;

export interface RelativeTimeOptions {
  /** The moment is expected to lie ahead of now (a session expiry), so it reads "in 23 h". */
  allowFuture?: boolean;
}

/**
 * Relative text for an instant: "just now", "3 min ago", "5 h ago", "2 d ago". Older than 30 days it falls back
 * to the UTC date. An instant in the future that is not expected ("allowFuture") is shown as its absolute time,
 * so a wrong clock is visible instead of hidden. Input with no zone is returned unchanged.
 */
export function formatRelativeTime(iso: string, nowMs: number, options: RelativeTimeOptions = {}): string {
  const at = parseInstant(iso);
  if (at === null) return iso;
  const diff = nowMs - at;

  if (diff < 0) {
    const ahead = -diff;
    if (!options.allowFuture) return ahead <= CLOCK_SKEW_MS ? 'just now' : formatTimestamp(iso);
    if (ahead < MINUTE_MS) return 'in <1 min';
    if (ahead < HOUR_MS) return `in ${Math.floor(ahead / MINUTE_MS)} min`;
    if (ahead < DAY_MS) return `in ${Math.floor(ahead / HOUR_MS)} h`;
    if (ahead < RELATIVE_LIMIT_DAYS * DAY_MS) return `in ${Math.floor(ahead / DAY_MS)} d`;
    return formatTimestamp(iso).slice(0, 10);
  }

  if (diff < MINUTE_MS) return 'just now';
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)} min ago`;
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)} h ago`;
  if (diff < RELATIVE_LIMIT_DAYS * DAY_MS) return `${Math.floor(diff / DAY_MS)} d ago`;
  return formatTimestamp(iso).slice(0, 10);
}

/** Short form for long identifiers: shortId("9f4d2c1a-...") -> "9f4d2c1a". Pair it with a CopyHash for the full value. */
export function shortId(id: string, length = 8): string {
  return id.length <= length ? id : id.slice(0, length);
}
