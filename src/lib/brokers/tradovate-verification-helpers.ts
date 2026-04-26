/**
 * Pure helpers for tradovate-verification.
 *
 * Extracted so unit tests can import them without triggering the prisma /
 * @/lib import chain in tradovate-verification.ts.
 */

import { TradovateClientError } from "./tradovate-client-helpers.ts";
import type {
  BrokerExecution,
  BrokerOrder,
  BrokerPosition,
} from "./types.ts";

export type CheckStatus = "pass" | "fail" | "skip";

export type CheckName =
  | "tokens"
  | "account_discovery"
  | "balance"
  | "positions"
  | "orders"
  | "executions"
  | "contracts";

export type TokenStatus =
  | "valid"
  | "expired"
  | "no_refresh"
  | "load_failed"
  | "config_missing"
  | "unknown";

export const CHECK_LABELS: Record<CheckName, string> = {
  tokens: "Token load and refresh",
  account_discovery: "Account discovery",
  balance: "Balance snapshot",
  positions: "Open positions",
  orders: "Working orders",
  executions: "Today's executions",
  contracts: "Contract symbol resolution",
};

/** Names that should be marked "skip" when tokens fail. */
export const SKIP_NAMES: CheckName[] = [
  "account_discovery",
  "balance",
  "positions",
  "orders",
  "executions",
  "contracts",
];

export function describeError(err: unknown): {
  code: string;
  message: string;
} {
  if (err instanceof TradovateClientError) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof Error) {
    return { code: "UNKNOWN", message: err.message };
  }
  return { code: "UNKNOWN", message: "Unknown error." };
}

export function tokenStatusFromErr(err: unknown): TokenStatus {
  if (!(err instanceof TradovateClientError)) return "unknown";
  switch (err.code) {
    case "CONFIG_MISSING":
      return "config_missing";
    case "TOKEN_EXPIRED_NO_REFRESH":
      return "no_refresh";
    case "REFRESH_FAILED":
    case "REFRESH_STORE_FAILED":
      return "expired";
    case "NO_TOKENS":
    case "TOKEN_LOAD_FAILED":
      return "load_failed";
    default:
      return "unknown";
  }
}

/** Detect whether contract resolution silently fell back to numeric IDs. */
export function hasUnresolvedContracts(
  positions: BrokerPosition[],
  orders: BrokerOrder[],
  executions: BrokerExecution[],
): boolean {
  const isNumeric = (s: string) => /^\d+$/.test(s);
  return (
    positions.some((p) => isNumeric(p.symbol)) ||
    orders.some((o) => isNumeric(o.symbol)) ||
    executions.some((e) => isNumeric(e.symbol))
  );
}
