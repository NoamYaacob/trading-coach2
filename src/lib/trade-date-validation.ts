/**
 * Pure utility for trade-date future-date validation.
 *
 * Keeping this as a pure function lets both the client form and the API
 * routes reuse identical logic, and makes it trivially testable.
 */

/**
 * Returns true when `tradedAt` is strictly after `now`.
 * Allow a small tolerance for clock skew between client and server.
 */
export function isFutureTradeDate(
  tradedAt: Date,
  now: Date = new Date(),
  toleranceMs: number = 0,
): boolean {
  return tradedAt.getTime() > now.getTime() + toleranceMs;
}
