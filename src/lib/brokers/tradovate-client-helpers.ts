/**
 * Pure mapping helpers and error types for the Tradovate client.
 *
 * Kept in a separate file so that unit tests can import these without
 * triggering the prisma / @/lib imports in tradovate-client.ts.
 */

import type {
  BrokerSide,
  BrokerOrderStatus,
  BrokerOrderType,
} from "./types.ts";

// ── Error ─────────────────────────────────────────────────────────────────────

export type TradovateClientErrorCode =
  | "CONFIG_MISSING"
  | "NO_TOKENS"
  | "NO_ACCOUNT_ID"
  | "TOKEN_LOAD_FAILED"
  | "TOKEN_EXPIRED_NO_REFRESH"
  | "REFRESH_FAILED"
  | "REFRESH_NO_ACCESS_TOKEN"
  | "REFRESH_STORE_FAILED"
  | "API_ERROR"
  | "NETWORK_ERROR"
  | "PARSE_ERROR"
  | "RECOVERY_PAYLOAD_INVALID";

export class TradovateClientError extends Error {
  readonly code: TradovateClientErrorCode;
  readonly statusCode: number | undefined;
  /** Excerpt of the HTTP response body — used by classifyRenewalError for 400 disambiguation. */
  readonly bodyExcerpt: string | undefined;

  constructor(
    code: TradovateClientErrorCode,
    message: string,
    statusCode?: number,
    bodyExcerpt?: string,
  ) {
    super(message);
    this.name = "TradovateClientError";
    this.code = code;
    this.statusCode = statusCode;
    this.bodyExcerpt = bodyExcerpt;
  }
}

// ── Mapping helpers ───────────────────────────────────────────────────────────

/**
 * Token renewal buffer: refresh 15 minutes before expiry.
 *
 * Tradovate access tokens last about 80 minutes. Tradovate community guidance
 * is to renew before the latest request reaches ~75 minutes — a generous buffer
 * here means a sync that takes a minute or two will never run with a token
 * expiring mid-call. The 5-minute buffer used previously was too tight: a
 * sync starting at "5min remaining" could easily blow through expiry while
 * fetching balance + positions + orders + fills + report sequentially.
 */
export const REFRESH_BUFFER_MS = 15 * 60 * 1000;

// ── Token renewal decision (pure) ─────────────────────────────────────────────

export type RenewalDecisionInput = {
  expiresAt: Date | null;
  now: Date;
  bufferMs: number;
};

export type RenewalDecision = {
  shouldRenew: boolean;
  /** Diagnostic reason, e.g. "no_expiry_known", "already_expired", "within_buffer", "valid_outside_buffer". */
  reason:
    | "no_expiry_known"
    | "already_expired"
    | "within_buffer"
    | "valid_outside_buffer";
  /** Milliseconds until expiry. Null when expiresAt is unknown. */
  msUntilExpiry: number | null;
};

/**
 * Decide whether to renew the access token before making a request.
 *
 * Renews when:
 *   - We have no recorded expiry (defensive: assume the token may be stale).
 *   - The token is already past expiry.
 *   - The token will expire within `bufferMs` of `now`.
 *
 * Pure — call from any execution context.
 */
export function shouldRenewToken(input: RenewalDecisionInput): RenewalDecision {
  if (input.expiresAt == null) {
    return { shouldRenew: true, reason: "no_expiry_known", msUntilExpiry: null };
  }
  const remaining = input.expiresAt.getTime() - input.now.getTime();
  if (remaining <= 0) {
    return { shouldRenew: true, reason: "already_expired", msUntilExpiry: remaining };
  }
  if (remaining <= input.bufferMs) {
    return { shouldRenew: true, reason: "within_buffer", msUntilExpiry: remaining };
  }
  return { shouldRenew: false, reason: "valid_outside_buffer", msUntilExpiry: remaining };
}

// ── Renewal failure classification (pure) ─────────────────────────────────────

/**
 * Classify a token-renewal failure so the caller can decide whether to mark
 * the connection as expired (auth_invalid) or surface a transient error
 * without mutating the connection's status (transient).
 *
 *   auth_invalid — Tradovate refused the credentials/refresh token and we
 *                  must require a re-authorization. Trigger UI re-connect.
 *                  Examples: 401, 403, 400 with invalid_grant / invalid_token,
 *                  Tradovate returned no accessToken in a 200 OK response.
 *   transient    — Tradovate failed to answer or returned a server error.
 *                  Do NOT mark the connection expired; let the next sync
 *                  retry. Examples: network error, 429, 5xx, parse error.
 *   unknown      — Can't classify (default conservative behavior is
 *                  "transient" so we don't unnecessarily expire users).
 */
export type RenewalErrorClass = "auth_invalid" | "transient" | "unknown";

export type RenewalErrorInput = {
  /** TradovateClientError.code or another short code identifier. */
  code?: string | null;
  /** HTTP status from the renew response, if any. */
  httpStatus?: number | null;
  /** Optional response body excerpt for invalid_grant/invalid_token detection. */
  bodyExcerpt?: string | null;
  /** True for fetch network errors / DNS / abort. */
  networkError?: boolean;
};

const AUTH_INVALID_BODY_MARKERS = [
  "invalid_grant",
  "invalid_token",
  "invalid_client",
  "unauthorized",
  "expired",
] as const;

export function classifyRenewalError(input: RenewalErrorInput): RenewalErrorClass {
  if (input.networkError) return "transient";

  // Specific code-based classifications take priority over status code.
  switch (input.code) {
    case "NETWORK_ERROR":
      return "transient";
    case "PARSE_ERROR":
      return "transient"; // Tradovate likely degraded, returning HTML/empty
    case "REFRESH_NO_ACCESS_TOKEN":
      return "auth_invalid"; // 200 OK but Tradovate refused to mint a new token
    case "TOKEN_EXPIRED_NO_REFRESH":
      return "auth_invalid";
    default:
      break;
  }

  const status = input.httpStatus;
  if (status != null) {
    if (status === 401 || status === 403) return "auth_invalid";
    if (status === 429) return "transient";
    if (status >= 500 && status < 600) return "transient";
    if (status === 400) {
      // 400 is ambiguous: it can be invalid_grant (auth) or a transient bad-request.
      // Use the response body to distinguish — callOAuthRefreshGrant reads and attaches
      // it as bodyExcerpt. Without recognized auth markers, treat as transient to avoid
      // false-expiring connections on server-side 400s.
      const body = (input.bodyExcerpt ?? "").toLowerCase();
      if (AUTH_INVALID_BODY_MARKERS.some((m) => body.includes(m))) return "auth_invalid";
      return "transient";
    }
    if (status >= 200 && status < 300) {
      // OK status but classification was requested — likely a body-level error.
      const body = (input.bodyExcerpt ?? "").toLowerCase();
      if (AUTH_INVALID_BODY_MARKERS.some((m) => body.includes(m))) return "auth_invalid";
    }
  }

  return "unknown";
}

// ── Token response normalization ──────────────────────────────────────────────

/**
 * Raw shape from any Tradovate token endpoint.
 *
 * Tradovate token endpoints return DIFFERENT field naming depending on which
 * endpoint is called:
 *   /auth/oauthtoken      — standard OAuth 2.0 snake_case
 *   /auth/renewAccessToken — Tradovate camelCase
 *
 * Both shapes are modelled here so normalizeTokenResponse() can handle either.
 */
export type TvTokenResponse = Partial<{
  // Standard OAuth 2.0 (from /auth/oauthtoken)
  access_token: string;
  refresh_token: string;
  expires_in: number;
  // Tradovate camelCase (from /auth/renewAccessToken and possibly /auth/oauthtoken)
  accessToken: string;
  refreshToken: string;
  mdAccessToken: string;
  md_access_token: string; // snake_case variant observed in some responses
  expirationTime: string;  // ISO 8601 datetime
  expiresIn: number;
  // Some Tradovate response shapes use "token" as the access token field
  token: string;
}>;

export type NormalizedTokens = {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
  hasMdAccessToken: boolean;
};

/**
 * Normalize a Tradovate token response to a consistent shape.
 *
 * Snake_case fields take priority so that standard OAuth responses are
 * handled correctly; camelCase is the fallback for Tradovate's own endpoints.
 *
 * expiresAt is computed from expires_in/expiresIn (seconds-from-now) or
 * from expirationTime (ISO string). Returns null if neither is present or
 * parseable.
 *
 * Does NOT assert that accessToken is non-null — callers must check.
 */
export function normalizeTokenResponse(raw: TvTokenResponse): NormalizedTokens {
  // Priority: access_token (OAuth snake_case) → accessToken (Tradovate camelCase) → token
  const accessToken =
    (typeof raw.access_token === "string" && raw.access_token ? raw.access_token : null) ??
    (typeof raw.accessToken === "string" && raw.accessToken ? raw.accessToken : null) ??
    (typeof raw.token === "string" && raw.token ? raw.token : null);

  const refreshToken =
    (typeof raw.refresh_token === "string" && raw.refresh_token ? raw.refresh_token : null) ??
    (typeof raw.refreshToken === "string" && raw.refreshToken ? raw.refreshToken : null);

  let expiresAt: Date | null = null;
  const expiresInSecs = raw.expires_in ?? raw.expiresIn;
  if (typeof expiresInSecs === "number" && expiresInSecs > 0) {
    expiresAt = new Date(Date.now() + expiresInSecs * 1000);
  } else if (typeof raw.expirationTime === "string" && raw.expirationTime) {
    const d = new Date(raw.expirationTime);
    if (Number.isFinite(d.getTime())) expiresAt = d;
  }

  const hasMdAccessToken =
    (typeof raw.mdAccessToken === "string" && raw.mdAccessToken.length > 0) ||
    (typeof raw.md_access_token === "string" && raw.md_access_token.length > 0);

  return { accessToken, refreshToken, expiresAt, hasMdAccessToken };
}

export function mapOrderStatus(s: string): BrokerOrderStatus {
  switch (s) {
    case "Working":
    case "Pending":
      return "WORKING";
    case "Completed":
      return "FILLED";
    case "Cancelled":
    case "Expired":
      return "CANCELLED";
    case "Rejected":
      return "REJECTED";
    default:
      return "WORKING";
  }
}

export function mapOrderType(t: string): BrokerOrderType {
  switch (t) {
    case "Limit":
    case "LMT":
      return "LIMIT";
    case "Market":
    case "MKT":
      return "MARKET";
    case "Stop":
      return "STOP";
    case "StopLimit":
    case "STPLMT":
      return "STOP_LIMIT";
    default:
      return "OTHER";
  }
}

export function mapSide(action: "Buy" | "Sell"): BrokerSide {
  return action === "Buy" ? "LONG" : "SHORT";
}

// ── Balance selection ─────────────────────────────────────────────────────────

export type BalanceCandidates = {
  netLiq?: number | null;
  totalCashValue?: number | null;
  cashBalance?: number | null;
  accountBalance?: number | null;
  amount?: number | null;
};

/**
 * Pick the best available balance from a Tradovate cash-balance snapshot.
 * Priority: netLiq > totalCashValue > cashBalance > accountBalance > amount.
 * Returns { value: null, field: null } when no finite numeric value is found.
 */
export function selectBestBalance(
  candidates: BalanceCandidates,
): { value: number | null; field: string | null } {
  const order: [keyof BalanceCandidates, string][] = [
    ["netLiq", "netLiq"],
    ["totalCashValue", "totalCashValue"],
    ["cashBalance", "cashBalance"],
    ["accountBalance", "accountBalance"],
    ["amount", "amount"],
  ];
  for (const [key, label] of order) {
    const v = candidates[key];
    if (v != null && Number.isFinite(v)) return { value: v, field: label };
  }
  return { value: null, field: null };
}

// ── Snapshot response normalisation ───────────────────────────────────────────

/**
 * Tradovate cash-balance endpoints return data in several shapes depending on
 * the endpoint and API version. Normalise all observed formats to a flat array
 * of snapshot-like objects so callers always deal with T[].
 *
 * Handled shapes:
 *   T[]                           — bare array (most list endpoints)
 *   T                             — single object (some "get" endpoints;
 *                                   detected by a numeric `accountId` field)
 *   { i: T[] }                    — Tradovate batch / websocket envelope
 *   { d|data|result|results|items: T[] }  — common REST wrappers
 */
export function parseSnapshotItems<T extends object>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw !== null && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    // Tradovate batch envelope
    if (Array.isArray(obj.i)) return obj.i as T[];
    // Common REST wrappers
    for (const key of ["d", "data", "result", "results", "items"] as const) {
      if (Array.isArray(obj[key])) return obj[key] as T[];
    }
    // Single item object — identified by having a numeric accountId field
    if (typeof obj.accountId === "number") return [raw as T];
  }
  return [];
}

// ── Snapshot balance + P&L extraction ────────────────────────────────────────

export type SnapshotForBalance = {
  netLiq?: number | null;
  totalCashValue?: number | null;
  cashBalance?: number | null;
  accountBalance?: number | null;
  amount?: number | null;
  /** Tradovate API field — uppercase L is the canonical casing. */
  realizedPnL?: number | null;
  /** Lowercase-l variant kept for defensive compat with older API responses. */
  realizedPnl?: number | null;
};

export type SnapshotBalanceResult = {
  balance: number | null;
  field: string | null;
  todayPnL: number | null;
};

/**
 * Extract balance and today's realised P&L from a Tradovate snapshot.
 *
 * Balance priority:
 *   netLiq > totalCashValue > cashBalance > accountBalance > amount
 *
 * `amount` in Tradovate cash-balance responses IS the current account balance
 * (not prior-session settlement), so it must NOT be combined with realizedPnL
 * — that would double-count today's P&L.
 *
 * todayPnL: realizedPnL (uppercase L, canonical) takes priority over
 * realizedPnl (lowercase, defensive fallback).
 */
export function computeSnapshotBalance(snap: SnapshotForBalance): SnapshotBalanceResult {
  const todayPnL =
    (typeof snap.realizedPnL === "number" && Number.isFinite(snap.realizedPnL)
      ? snap.realizedPnL
      : null) ??
    (typeof snap.realizedPnl === "number" && Number.isFinite(snap.realizedPnl)
      ? snap.realizedPnl
      : null);

  const { value: preferredBalance, field } = selectBestBalance({
    netLiq: snap.netLiq,
    totalCashValue: snap.totalCashValue,
    cashBalance: snap.cashBalance,
    accountBalance: snap.accountBalance,
    amount: snap.amount,
  });

  if (preferredBalance != null) {
    return { balance: preferredBalance, field, todayPnL };
  }

  return { balance: null, field: null, todayPnL };
}

// ── Fill P&L aggregation ──────────────────────────────────────────────────────

/**
 * Sum an array of per-fill P&L values, skipping nulls and non-finite numbers.
 * Returns null when no finite value is present (so callers can distinguish
 * "zero P&L" from "no P&L data available").
 */
export function sumFillPnl(pnls: (number | null | undefined)[]): number | null {
  let total = 0;
  let hasAny = false;
  for (const p of pnls) {
    if (typeof p === "number" && Number.isFinite(p)) {
      total += p;
      hasAny = true;
    }
  }
  return hasAny ? total : null;
}

// ── Fill timestamp extraction ─────────────────────────────────────────────────

/**
 * Extract the best available ISO-date string from a raw Tradovate fill item.
 *
 * Tradovate fill responses may use:
 *   timestamp   — ISO string "2026-05-04T20:30:45Z"
 *   tradeDate   — object {year:2026, month:5, day:4} OR ISO string
 *   time/tradeTime/executionTime/createdAt — ISO string variants
 *
 * Returns null when no recognizable date field is found.
 */
export function extractFillTimestamp(fill: Record<string, unknown>): string | null {
  for (const key of ["timestamp", "time", "tradeTime", "executionTime", "createdAt"]) {
    const v = fill[key];
    if (typeof v === "string" && v.length >= 10) return v;
  }
  const td = fill.tradeDate;
  if (td !== null && typeof td === "object" && !Array.isArray(td)) {
    const { year, month, day } = td as Record<string, unknown>;
    if (typeof year === "number" && typeof month === "number" && typeof day === "number") {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  if (typeof td === "string" && td.length >= 10) return td;
  return null;
}

// ── Entry-based trade counting ────────────────────────────────────────────────

export type EntryFill = {
  side: "LONG" | "SHORT";
  quantity: number;
  symbol: string;
  occurredAt: Date;
  /** Broker order id used to deduplicate partial fills of the same parent order. */
  orderId?: string | null;
};

/**
 * Count the number of distinct "entry decision" trades in a set of executions.
 *
 * Product definition (NOT raw fill count):
 *  - New position from flat                   → +1 trade
 *  - Scale-in (adding to an existing same-side
 *    position)                                → +1 trade
 *  - Reversal (crossing zero in one motion)   → +1 trade in the new direction
 *  - Reductions / partial exits / full closes → 0 new trades
 *  - Partial fills of the same parent order   → aggregated into one decision
 *
 * Partial fills are deduplicated by `orderId` so that a single broker order
 * filled in three slices counts as one entry, not three. Fills with a missing
 * orderId are kept as individual rows (defensive — the broker rarely omits it
 * but we must not silently merge unrelated fills).
 */
export function countEntryTrades(executions: EntryFill[]): number {
  // Step 1: Group fills by orderId+side+symbol so partial fills of one parent
  // order count as a single decision. The trader placed one order; how the
  // broker filled it is an implementation detail.
  type Group = {
    side: "LONG" | "SHORT";
    quantity: number;
    symbol: string;
    occurredAt: Date;
  };
  const grouped = new Map<string, Group>();
  let unkeyed = 0;
  for (const ex of executions) {
    const key =
      ex.orderId != null && ex.orderId !== ""
        ? `oid:${ex.orderId}:${ex.side}:${ex.symbol}`
        : `unkeyed:${unkeyed++}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.quantity += ex.quantity;
      if (ex.occurredAt.getTime() < existing.occurredAt.getTime()) {
        existing.occurredAt = ex.occurredAt;
      }
    } else {
      grouped.set(key, {
        side: ex.side,
        quantity: ex.quantity,
        symbol: ex.symbol,
        occurredAt: ex.occurredAt,
      });
    }
  }

  // Step 2: Walk grouped orders chronologically and track net position per
  // symbol. Each time the position opens from flat, scales in same-direction,
  // or reverses across zero, count one entry trade.
  const sorted = [...grouped.values()].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
  const positions = new Map<string, number>();
  let trades = 0;
  for (const ex of sorted) {
    const prev = positions.get(ex.symbol) ?? 0;
    const delta = ex.side === "LONG" ? ex.quantity : -ex.quantity;
    const next = prev + delta;
    positions.set(ex.symbol, next);

    if (prev === 0 && next !== 0) {
      // Open from flat
      trades++;
    } else if (prev !== 0 && next !== 0 && Math.sign(prev) !== Math.sign(next)) {
      // Reversal: crossed zero in one motion (the new opposite-side exposure
      // is the new entry; the implicit close of the prior side is not counted).
      trades++;
    } else if (
      prev !== 0 &&
      Math.sign(prev) === Math.sign(next) &&
      Math.abs(next) > Math.abs(prev)
    ) {
      // Scale-in: same direction, position grew → another entry decision.
      trades++;
    }
    // else: reduction, partial close, or full close — not a new entry.
  }
  return trades;
}

/**
 * Count entry-based trades whose `occurredAt` is at or after `since`.
 *
 * Used to derive a "trades since connected" count separately from the full
 * day count. Executions with timestamps strictly before `since` are dropped
 * before counting, so any pre-connection net position is implicitly treated
 * as flat at `since` for the purpose of detecting new entries.
 */
export function countEntryTradesSince(executions: EntryFill[], since: Date): number {
  const cutoff = since.getTime();
  return countEntryTrades(executions.filter((ex) => ex.occurredAt.getTime() >= cutoff));
}

// ── Entry trade diagnostic trace ─────────────────────────────────────────────

export type EntryTraceRow = {
  orderId: string | null;
  symbol: string;
  side: "LONG" | "SHORT";
  qty: number;
  positionBefore: number;
  positionAfter: number;
  entry: boolean;
  reason: "flat_open" | "reversal" | "scale_in" | "reduction";
};

export type EntryTraceResult = {
  count: number;
  uniqueOrderIds: number;
  groupedCount: number;
  rows: EntryTraceRow[];
};

/**
 * Same counting logic as countEntryTrades, but also returns per-order diagnostics
 * for server-side logging. Used in sync to emit positionBefore/positionAfter/reason
 * rows so logs can be compared against Tradovate's Performance Report.
 *
 * Invariant: traceEntryTrades(ex).count === countEntryTrades(ex) for any input.
 */
export function traceEntryTrades(executions: EntryFill[]): EntryTraceResult {
  type Group = {
    orderId: string | null;
    side: "LONG" | "SHORT";
    quantity: number;
    symbol: string;
    occurredAt: Date;
  };
  const grouped = new Map<string, Group>();
  const orderIdSet = new Set<string>();
  let unkeyed = 0;

  for (const ex of executions) {
    if (ex.orderId != null && ex.orderId !== "") orderIdSet.add(ex.orderId);
    const key =
      ex.orderId != null && ex.orderId !== ""
        ? `oid:${ex.orderId}:${ex.side}:${ex.symbol}`
        : `unkeyed:${unkeyed++}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.quantity += ex.quantity;
      if (ex.occurredAt.getTime() < existing.occurredAt.getTime()) {
        existing.occurredAt = ex.occurredAt;
      }
    } else {
      grouped.set(key, {
        orderId: ex.orderId ?? null,
        side: ex.side,
        quantity: ex.quantity,
        symbol: ex.symbol,
        occurredAt: ex.occurredAt,
      });
    }
  }

  const sorted = [...grouped.values()].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
  const positions = new Map<string, number>();
  let count = 0;
  const rows: EntryTraceRow[] = [];

  for (const ex of sorted) {
    const prev = positions.get(ex.symbol) ?? 0;
    const delta = ex.side === "LONG" ? ex.quantity : -ex.quantity;
    const next = prev + delta;
    positions.set(ex.symbol, next);

    let entry = false;
    let reason: EntryTraceRow["reason"] = "reduction";
    if (prev === 0 && next !== 0) {
      entry = true;
      reason = "flat_open";
      count++;
    } else if (prev !== 0 && next !== 0 && Math.sign(prev) !== Math.sign(next)) {
      entry = true;
      reason = "reversal";
      count++;
    } else if (
      prev !== 0 &&
      Math.sign(prev) === Math.sign(next) &&
      Math.abs(next) > Math.abs(prev)
    ) {
      entry = true;
      reason = "scale_in";
      count++;
    }

    rows.push({
      orderId: ex.orderId ?? null,
      symbol: ex.symbol,
      side: ex.side,
      qty: ex.quantity,
      positionBefore: prev,
      positionAfter: next,
      entry,
      reason,
    });
  }

  return { count, uniqueOrderIds: orderIdSet.size, groupedCount: grouped.size, rows };
}

// ── Fill account matching ─────────────────────────────────────────────────────

/**
 * Return true when a raw Tradovate fill carries an account identifier
 * (`accountId` or `accountSpec`). Used to detect when `fill/list` returned
 * fills without account fields — in that case our `fillMatchesAccount`
 * filter falls through to "include all" and account isolation breaks.
 */
export function fillCarriesAccountId(fill: Record<string, unknown>): boolean {
  return typeof fill.accountId === "number" || typeof fill.accountSpec === "string";
}

/**
 * Decide whether the trade count derived from a `fill/list` response is
 * suspect because the response wasn't account-scoped at the API level AND
 * the fills don't carry per-row account identifiers.
 *
 * Returns true when ALL of:
 *   - The unscoped `fill/list` endpoint was used (deps fallback wasn't tried
 *     or failed).
 *   - We know the target Tradovate account ID (so we *should* be filtering).
 *   - At least one fill came back.
 *   - None of the returned fills carry `accountId` or `accountSpec`, so the
 *     client-side `fillMatchesAccount` filter cannot distinguish accounts.
 *
 * When this returns true, the same fill set is being returned for every
 * account on a multi-account OAuth token and the trade count is unreliable.
 */
export function isAccountScopingSuspect(input: {
  tvAccountId: number | null;
  fills: ReadonlyArray<Record<string, unknown>>;
}): boolean {
  if (input.tvAccountId === null) return false;
  if (input.fills.length === 0) return false;
  return !input.fills.some(fillCarriesAccountId);
}

/**
 * Return true if a raw Tradovate fill item belongs to the given account.
 *
 * Tradovate fills carry account identity in three possible ways:
 *  - accountId (number) — present on some endpoints
 *  - accountSpec (string like "FIRM/12345") — present on others
 *  - neither — when the response is already scoped to one account
 *
 * When neither field is present we assume the response is already scoped and
 * include the fill (the caller's account filter is best-effort for multi-account
 * tokens; single-account tokens need no filtering).
 */
export function fillMatchesAccount(fill: Record<string, unknown>, tvAccountId: number): boolean {
  const fId = fill.accountId;
  if (typeof fId === "number") return fId === tvAccountId;
  const fSpec = fill.accountSpec;
  if (typeof fSpec === "string") {
    return fSpec.split("/").at(-1) === String(tvAccountId);
  }
  return true; // neither field present — assume already-scoped
}
