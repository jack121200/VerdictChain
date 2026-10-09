/**
 * Which cited values may be treated as facts about the log. The Watchdog re-checks every citation against
 * raw_logs: only a VERIFIED citation's value equals what the row really holds. A DISCREPANCY or INVALID_ROW
 * value is just what an agent claimed, so it must never become an attributed subject, host or time.
 * A citation without a status (not yet checked, or a plain test object) is not excluded.
 */
export function isVerifiedClaim(citation: { status?: string }): boolean {
  return citation.status === undefined || citation.status === 'VERIFIED';
}
