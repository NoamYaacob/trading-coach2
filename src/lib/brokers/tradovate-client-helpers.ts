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
  | "TOKEN_LOAD_FAILED"
  | "TOKEN_EXPIRED_NO_REFRESH"
  | "REFRESH_FAILED"
  | "REFRESH_NO_ACCESS_TOKEN"
  | "REFRESH_STORE_FAILED"
  | "API_ERROR"
  | "NETWORK_ERROR"
  | "PARSE_ERROR";

export class TradovateClientError extends Error {
  readonly code: TradovateClientErrorCode;
  readonly statusCode: number | undefined;

  constructor(
    code: TradovateClientErrorCode,
    message: string,
    statusCode?: number,
  ) {
    super(message);
    this.name = "TradovateClientError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

// ── Mapping helpers ───────────────────────────────────────────────────────────

/** Token refresh buffer: refresh 5 minutes before expiry. */
export const REFRESH_BUFFER_MS = 5 * 60 * 1000;

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
