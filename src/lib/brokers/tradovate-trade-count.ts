/**
 * Per-account trade count resolver for Tradovate.
 *
 * The unscoped /fill/list endpoint returns ALL fills for the OAuth token's
 * accounts mixed together, with `accountId`/`accountSpec` typically absent.
 * On multi-account tokens that means the same fill set drives every
 * account's trade count, producing identical (and inflated) numbers like
 * "12 / 3" for both MFFUEVBLDR…6248 and …6249 even when the broker's own
 * Performance Report shows 6 and 11 respectively.
 *
 * This module tries a chain of progressively-less-trusted sources, in order,
 * and returns the first one that produces a count we can attribute to a
 * single account:
 *
 *   1. broker_report           — POST /reports/requestreport (Performance)
 *   2. account_scoped_orders   — GET /order/deps?masterid={tvAccountId}
 *      (spec: masterid = Account entity ID — correctly account-scoped)
 *   3. fills_unscoped_estimated — last-resort fill/list (NOT authoritative)
 *
 * NOTE: fill/deps and fillPair/deps are NOT used. Per the Tradovate OpenAPI
 * spec, fill/deps takes masterid = Order entity ID and fillPair/deps takes
 * masterid = Position entity ID. Neither is account-scoped; passing tvAccountId
 * to them returns fills/pairs for a coincidental order/position with that
 * numeric ID, not for the account.
 *
 * The resolver is built around an adapter so each source can be unit-tested
 * with stub fetchers and so the live network calls live in TradovateClient
 * (where token handling already lives).
 */

import { parsePerformanceReportTradeCount } from "./tradovate-reports-parser.ts";

export type TradeCountSourceLabel =
  | "broker_report"
  | "account_scoped_orders"
  | "fills_unscoped_estimated"
  | "unavailable";

export type TradeCountAttempt = {
  source: TradeCountSourceLabel;
  endpoint: string;
  ok: boolean;
  httpStatus?: number;
  derivedCount?: number;
  responseShape?: string;
  notes?: string;
};

export type TradeCountResult = {
  count: number | null;
  source: TradeCountSourceLabel;
  /** Maps to LiveSessionState.tradeCountSource. */
  trustLevel: "verified" | "estimated" | "unavailable";
  attempts: TradeCountAttempt[];
};

export type ReportFetchResult = {
  status: number;
  body: string;
  contentType: string | null;
};

export type ScopedOrdersFetchResult = {
  /** Number of completed (filled) orders attributable to this account today. */
  count: number;
  /** True only when the response carried per-row accountId for every kept order
   *  (i.e. the API genuinely scoped — or the response was already filtered). */
  accountScopedAtApi: boolean;
  httpStatus?: number;
  endpoint: string;
};

export type UnscopedFillsFallbackResult = {
  count: number;
  endpoint: string;
};

/**
 * Per-source fetchers. Each returns null when the source isn't applicable
 * (e.g. accountName missing for the report) or throws when a transient error
 * should propagate. Returning a result with `ok=false` indicates the source
 * answered but the answer can't be used.
 */
export type TradeCountAdapter = {
  /** Fetch the Tradovate account name (account.name) for the report's `account` param. */
  getAccountName(): Promise<string | null>;
  fetchPerformanceReport(input: {
    accountName: string;
    /** YYYY-MM-DD CME trading day key (CT session date). */
    tradingDayKey: string;
  }): Promise<ReportFetchResult | null>;
  fetchAccountScopedOrders(): Promise<ScopedOrdersFetchResult | null>;
  fetchUnscopedFillsFallback(): Promise<UnscopedFillsFallbackResult | null>;
};

export type ResolveTradeCountInput = {
  /** YYYY-MM-DD CME Globex trading day key (America/Chicago session date). */
  tradingDayKey: string;
};

/**
 * Phase C authoritative trade count source selection.
 *
 * Priority 1 — Tradovate Performance Report (broker_report):
 *   POST /v1/reports/requestreport is the same "# of Trades" shown in
 *   Tradovate's own UI. Used when available.
 *
 * Priority 2 — Canonical DB count (canonical_db):
 *   Position-aware fill count from NormalizedTradeEvent records. Used when
 *   the Performance Report is unavailable or fails.
 *
 * This is the live production path. resolveTradeCount (below) is kept for
 * diagnostic logging only and uses a different fallback chain (order/deps).
 */
export function selectPhaseCTradeCount(
  performanceReportCount: number | null,
  canonicalCount: number,
): { count: number; source: "broker_report" | "canonical_db" } {
  if (performanceReportCount !== null) {
    return { count: performanceReportCount, source: "broker_report" };
  }
  return { count: canonicalCount, source: "canonical_db" };
}

/**
 * Run the source chain and return the first verified count, plus a full
 * trail of attempts for diagnostic logging. Never throws — adapter errors
 * are swallowed and recorded in the attempts list.
 */
export async function resolveTradeCount(
  adapter: TradeCountAdapter,
  input: ResolveTradeCountInput,
): Promise<TradeCountResult> {
  const attempts: TradeCountAttempt[] = [];

  // ── 1. Broker Performance Report ───────────────────────────────────────────
  const accountName = await safeCall(adapter.getAccountName.bind(adapter));
  if (accountName) {
    const report = await safeCall(() =>
      adapter.fetchPerformanceReport({ accountName, tradingDayKey: input.tradingDayKey }),
    );
    if (report) {
      const ok2xx = report.status >= 200 && report.status < 300;
      if (ok2xx) {
        const count = parsePerformanceReportTradeCount({
          body: report.body,
          contentType: report.contentType,
        });
        attempts.push({
          source: "broker_report",
          endpoint: "/v1/reports/requestreport",
          ok: count != null,
          httpStatus: report.status,
          derivedCount: count ?? undefined,
          responseShape: describeContentType(report.contentType),
          notes: count == null ? "Response parsed but no '# of Trades' found." : undefined,
        });
        if (count != null) {
          return {
            count,
            source: "broker_report",
            trustLevel: "verified",
            attempts,
          };
        }
      } else {
        attempts.push({
          source: "broker_report",
          endpoint: "/v1/reports/requestreport",
          ok: false,
          httpStatus: report.status,
          responseShape: describeContentType(report.contentType),
          notes: report.status === 400
            ? `broker_report_unavailable — HTTP 400: ${report.body.slice(0, 120)}`
            : undefined,
        });
      }
    } else {
      attempts.push({
        source: "broker_report",
        endpoint: "/v1/reports/requestreport",
        ok: false,
        notes: "fetchPerformanceReport returned null (not configured or network error).",
      });
    }
  } else {
    attempts.push({
      source: "broker_report",
      endpoint: "/v1/reports/requestreport",
      ok: false,
      notes: "Account name unavailable — cannot scope report request.",
    });
  }

  // ── 2. Account-scoped orders ───────────────────────────────────────────────
  const orders = await safeCall(adapter.fetchAccountScopedOrders.bind(adapter));
  if (orders) {
    attempts.push({
      source: "account_scoped_orders",
      endpoint: orders.endpoint,
      ok: orders.accountScopedAtApi,
      httpStatus: orders.httpStatus,
      derivedCount: orders.count,
      notes: orders.accountScopedAtApi
        ? undefined
        : "Response not verifiably account-scoped — skipping for trust level.",
    });
    if (orders.accountScopedAtApi) {
      return {
        count: orders.count,
        source: "account_scoped_orders",
        trustLevel: "verified",
        attempts,
      };
    }
  } else {
    attempts.push({
      source: "account_scoped_orders",
      endpoint: "order/deps?masterid={tvAccountId}",
      ok: false,
      notes: "fetchAccountScopedOrders returned null.",
    });
  }

  // ── 3. Last resort: unscoped fill/list, marked as estimated ────────────────
  const fallback = await safeCall(adapter.fetchUnscopedFillsFallback.bind(adapter));
  if (fallback) {
    attempts.push({
      source: "fills_unscoped_estimated",
      endpoint: fallback.endpoint,
      ok: false, // ok=false because not authoritative
      derivedCount: fallback.count,
      notes:
        "Used unscoped fill/list — count may include other accounts on the same OAuth token. NOT authoritative.",
    });
    return {
      count: fallback.count,
      source: "fills_unscoped_estimated",
      trustLevel: "estimated",
      attempts,
    };
  }

  attempts.push({
    source: "unavailable",
    endpoint: "(none)",
    ok: false,
    notes: "All sources failed or returned no data.",
  });
  return { count: null, source: "unavailable", trustLevel: "unavailable", attempts };
}

async function safeCall<T>(fn: () => Promise<T | null>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

function describeContentType(ct: string | null | undefined): string {
  if (!ct) return "unknown";
  const lower = ct.toLowerCase();
  if (lower.includes("json")) return "json";
  if (lower.includes("html")) return "html";
  if (lower.includes("csv")) return "csv";
  if (lower.includes("xml")) return "xml";
  if (lower.includes("text/plain")) return "text";
  return ct;
}
