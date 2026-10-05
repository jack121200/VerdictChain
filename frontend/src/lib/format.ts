/** Display formatting. Every function returns an em dash for values that are not finite numbers. */

const EM_DASH = '—';

const COUNT_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Integer with thousands separators: 1234 -> "1,234". */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return EM_DASH;
  return COUNT_FORMAT.format(value);
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

/** ISO timestamp as "2026-10-05 14:03:22 UTC". Unparseable input is returned unchanged, never guessed. */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`;
}

/** Short form for long identifiers: shortId("9f4d2c1a-...") -> "9f4d2c1a". */
export function shortId(id: string, length = 8): string {
  return id.length <= length ? id : id.slice(0, length);
}
