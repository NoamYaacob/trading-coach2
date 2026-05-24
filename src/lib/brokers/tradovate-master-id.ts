/**
 * Strict validation for Tradovate `masterid` (the integer account ID used to
 * scope userAccountAutoLiq read/write calls).
 *
 * The DB-side `externalAccountId` is a string column populated from Tradovate's
 * `/account/list` response. The Tradovate API contract is that the value is an
 * integer; in practice we have seen leading/trailing whitespace and (very
 * rarely) entirely non-numeric placeholder rows from corrupted syncs.
 *
 * Failure mode this guards against:
 *   `parseInt("abc", 10)`        → NaN
 *   `parseInt("123abc", 10)`     → 123 (silent truncation)
 *   `parseInt("", 10)`           → NaN
 *   `parseInt(null as any, 10)`  → NaN
 *
 * Any of those values flowing into a URL like
 *   userAccountAutoLiq/deps?masterid=NaN
 * either (a) scopes the call to no account, or worse, (b) is silently coerced
 * by an upstream proxy to "0" or the user's first account. Either outcome
 * means a broker write could land on the wrong account.
 *
 * `parseTradovateMasterId` returns null for ANY invalid input. Callers must
 * treat null as a fail-closed signal — do NOT instantiate the client or send
 * any broker call.
 */

const STRICT_INTEGER_RE = /^-?\d+$/;

export function parseTradovateMasterId(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // Strict whole-string match — rejects "123abc", "12.5", "1e3", "+123" etc.
  if (!STRICT_INTEGER_RE.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) return null;
  if (!Number.isInteger(parsed)) return null;
  // Tradovate account IDs are always positive integers.
  if (parsed <= 0) return null;
  return parsed;
}

/**
 * Returns true when the raw externalAccountId is a valid Tradovate masterid.
 * Thin wrapper used by gate-evaluation code that needs a boolean.
 */
export function isValidTradovateMasterId(raw: string | null | undefined): boolean {
  return parseTradovateMasterId(raw) != null;
}
