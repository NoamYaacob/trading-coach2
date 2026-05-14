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

// ── Account categorization ────────────────────────────────────────────────────

export type AccountCategory = "live" | "demo" | "sim" | "prop" | "unknown";

export type TvAccountSummary = {
  id: number;
  name: string;
  accountType: string | null;
  status: string | null;
  active: boolean;
  archived: boolean;
  category: AccountCategory;
};

/**
 * Infer the likely environment of a Tradovate account from its name and
 * accountType. Pure function — safe for unit tests, no network or DB.
 *
 * Priority:
 *   1. Explicit "Demo" accountType → demo
 *   2. accountType or name containing "sim" → sim
 *   3. Name starting with "DEMO" or containing word "demo" → demo
 *   4. Known live accountType strings (Customer, Funding, Corporate) → live
 *   5. Common prop-firm name fragments → prop
 *   6. Anything else → unknown
 */
export function categorizeTvAccount(a: {
  name: string;
  accountType?: string | null;
}): AccountCategory {
  const typeL = (a.accountType ?? "").toLowerCase().trim();
  const nameL = a.name.toLowerCase().trim();

  if (typeL === "demo") return "demo";
  if (typeL.includes("sim")) return "sim";
  if (nameL.startsWith("demo") || /\bdemo\b/.test(nameL)) return "demo";
  if (nameL.startsWith("sim") || /\bsim\b/.test(nameL)) return "sim";
  // Prop firm name patterns before live accountType: prop firms are
  // registered as "Customer" in Tradovate but the account name reveals them.
  if (/prop|funded|apex|topstep|tradeday|mff|bulenox|ftmo|livetraders/i.test(nameL)) return "prop";
  if (typeL === "customer" || typeL === "funding" || typeL === "corporate") return "live";
  return "unknown";
}

// ── Check types ───────────────────────────────────────────────────────────────

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
