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
