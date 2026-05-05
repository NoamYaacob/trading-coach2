import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  resolveTradeCount,
  type TradeCountAdapter,
} from "./tradovate-trade-count.ts";

// ── Stub adapter helpers ──────────────────────────────────────────────────────

type StubBehaviour = {
  accountName?: string | null;
  reportBody?: string | null;
  reportStatus?: number;
  reportContentType?: string | null;
  reportThrows?: boolean;
  ordersResult?: {
    count: number;
    accountScopedAtApi: boolean;
    httpStatus?: number;
  } | null;
  ordersThrows?: boolean;
  fillPairsResult?: {
    count: number;
    accountScopedAtApi: boolean;
    httpStatus?: number;
  } | null;
  fillsResult?: {
    count: number;
    accountScopedAtApi: boolean;
    httpStatus?: number;
  } | null;
  unscopedFallback?: { count: number } | null;
};

function stubAdapter(b: StubBehaviour): TradeCountAdapter {
  return {
    getAccountName: async () => b.accountName ?? null,
    fetchPerformanceReport: async (_input: { accountName: string; tradingDayKey: string }) => {
      if (b.reportThrows) throw new Error("network down");
      if (b.reportBody == null) return null;
      return {
        status: b.reportStatus ?? 200,
        body: b.reportBody,
        contentType: b.reportContentType ?? "text/html",
      };
    },
    fetchAccountScopedOrders: async () => {
      if (b.ordersThrows) throw new Error("orders 500");
      if (b.ordersResult == null) return null;
      return { ...b.ordersResult, endpoint: "order/deps?masterid=X" };
    },
    fetchAccountScopedFillPairs: async () => {
      if (b.fillPairsResult == null) return null;
      return { ...b.fillPairsResult, endpoint: "fillPair/deps?masterid=X" };
    },
    fetchAccountScopedFills: async () => {
      if (b.fillsResult == null) return null;
      return { ...b.fillsResult, endpoint: "fill/deps?masterid=X" };
    },
    fetchUnscopedFillsFallback: async () => {
      if (b.unscopedFallback == null) return null;
      return { ...b.unscopedFallback, endpoint: "fill/list (cached)" };
    },
  };
}

const TRADING_DAY_KEY = "2026-05-05";

// ── Source selection ──────────────────────────────────────────────────────────

describe("resolveTradeCount — source preference order", () => {
  it("prefers broker_report when it returns a parseable count", async () => {
    const adapter = stubAdapter({
      accountName: "MFFUEVBLDR133936249",
      reportBody: `<table><tr><td># of Trades</td><td>11</td></tr></table>`,
      reportContentType: "text/html",
      ordersResult: { count: 99, accountScopedAtApi: true },
      unscopedFallback: { count: 12 },
    });
    const result = await resolveTradeCount(adapter, { tradingDayKey: TRADING_DAY_KEY });
    assert.equal(result.source, "broker_report");
    assert.equal(result.count, 11);
    assert.equal(result.trustLevel, "verified");
  });

  it("falls through to account_scoped_orders when report can't be parsed", async () => {
    const adapter = stubAdapter({
      accountName: "MFFUEVBLDR133936249",
      reportBody: `<p>no recognizable label here</p>`,
      reportContentType: "text/html",
      ordersResult: { count: 11, accountScopedAtApi: true },
      unscopedFallback: { count: 12 },
    });
    const result = await resolveTradeCount(adapter, { tradingDayKey: TRADING_DAY_KEY });
    assert.equal(result.source, "account_scoped_orders");
    assert.equal(result.count, 11);
    assert.equal(result.trustLevel, "verified");
  });

  it("falls through when report returns 401 (unauthorized for OAuth scope)", async () => {
    const adapter = stubAdapter({
      accountName: "MFFUEVBLDR133936249",
      reportBody: `unauthorized`,
      reportStatus: 401,
      ordersResult: { count: 11, accountScopedAtApi: true },
    });
    const result = await resolveTradeCount(adapter, { tradingDayKey: TRADING_DAY_KEY });
    assert.equal(result.source, "account_scoped_orders");
    assert.equal(result.count, 11);
    // Confirm the failed attempt is logged in the trail
    const reportAttempt = result.attempts.find((a) => a.source === "broker_report");
    assert.ok(reportAttempt);
    assert.equal(reportAttempt.ok, false);
    assert.equal(reportAttempt.httpStatus, 401);
  });

  it("does NOT trust account_scoped_orders when accountScopedAtApi=false", async () => {
    const adapter = stubAdapter({
      accountName: null, // skip report
      ordersResult: { count: 99, accountScopedAtApi: false }, // unverified
      fillPairsResult: { count: 11, accountScopedAtApi: true },
    });
    const result = await resolveTradeCount(adapter, { tradingDayKey: TRADING_DAY_KEY });
    assert.equal(result.source, "account_scoped_fill_pairs");
    assert.equal(result.count, 11);
  });

  it("falls through to fill_pairs when orders are not scoped", async () => {
    const adapter = stubAdapter({
      accountName: null,
      ordersResult: null,
      fillPairsResult: { count: 6, accountScopedAtApi: true },
      unscopedFallback: { count: 12 },
    });
    const result = await resolveTradeCount(adapter, { tradingDayKey: TRADING_DAY_KEY });
    assert.equal(result.source, "account_scoped_fill_pairs");
    assert.equal(result.count, 6);
    assert.equal(result.trustLevel, "verified");
  });

  it("falls through to fill/deps when fill pairs aren't available", async () => {
    const adapter = stubAdapter({
      accountName: null,
      fillsResult: { count: 11, accountScopedAtApi: true },
    });
    const result = await resolveTradeCount(adapter, { tradingDayKey: TRADING_DAY_KEY });
    assert.equal(result.source, "account_scoped_fills");
    assert.equal(result.count, 11);
    assert.equal(result.trustLevel, "verified");
  });
});

// ── Multi-account regression: never assigns the same count to both accounts ──

describe("resolveTradeCount — multi-account OAuth (the production bug)", () => {
  it("when the only available source is the unscoped fallback, count is 'estimated'", async () => {
    // Both accounts on the same OAuth token would receive the same fill list.
    // The resolver MUST mark the count as estimated, not verified, so the
    // dashboard skips trade-limit enforcement and shows the disclaimer.
    const adapter = stubAdapter({
      accountName: null,
      ordersResult: null,
      fillPairsResult: null,
      fillsResult: null,
      unscopedFallback: { count: 12 },
    });
    const result = await resolveTradeCount(adapter, { tradingDayKey: TRADING_DAY_KEY });
    assert.equal(result.source, "fills_unscoped_estimated");
    assert.equal(result.count, 12);
    assert.equal(result.trustLevel, "estimated");
  });

  it("returns 'unavailable' when every source fails", async () => {
    const adapter = stubAdapter({
      accountName: null,
      ordersResult: null,
      fillPairsResult: null,
      fillsResult: null,
      unscopedFallback: null,
    });
    const result = await resolveTradeCount(adapter, { tradingDayKey: TRADING_DAY_KEY });
    assert.equal(result.source, "unavailable");
    assert.equal(result.count, null);
    assert.equal(result.trustLevel, "unavailable");
  });

  it("an adapter throwing is recorded as a failed attempt, not crashing the resolver", async () => {
    const adapter = stubAdapter({
      accountName: "MFFUEVBLDR133936248",
      reportThrows: true,
      ordersThrows: true,
      fillsResult: { count: 6, accountScopedAtApi: true },
    });
    const result = await resolveTradeCount(adapter, { tradingDayKey: TRADING_DAY_KEY });
    assert.equal(result.source, "account_scoped_fills");
    assert.equal(result.count, 6);
  });
});

// ── Daily-loss enforcement is unaffected by trade count source ────────────────

describe("resolveTradeCount — daily-loss enforcement contract", () => {
  // The resolver only deals with trade count. Daily P&L (used for daily-loss
  // enforcement) flows through a different path (cashBalance/getCashBalanceSnapshot
  // which is account-scoped at the API). This test documents the contract:
  // the resolver returning "unavailable" for trades does not affect daily loss.

  it("contract: unavailable trade count must not affect a sibling daily-loss flow", async () => {
    const adapter = stubAdapter({
      accountName: null,
      ordersResult: null,
      unscopedFallback: null,
    });
    const result = await resolveTradeCount(adapter, { tradingDayKey: TRADING_DAY_KEY });
    assert.equal(result.trustLevel, "unavailable");
    // No assertion on daily P&L — it is computed independently by the sync.
    // This test exists to document that the resolver knows nothing about it.
    assert.ok(true);
  });
});

// ── Attempts trail is always populated ────────────────────────────────────────

describe("resolveTradeCount — attempts trail", () => {
  it("logs an attempt for broker_report even when accountName is null", async () => {
    const adapter = stubAdapter({
      accountName: null,
      ordersResult: { count: 5, accountScopedAtApi: true },
    });
    const result = await resolveTradeCount(adapter, { tradingDayKey: TRADING_DAY_KEY });
    const reportAttempt = result.attempts.find((a) => a.source === "broker_report");
    assert.ok(reportAttempt);
    assert.equal(reportAttempt.ok, false);
    assert.match(reportAttempt.notes ?? "", /Account name unavailable/);
  });

  it("logs every source visited up to and including the winning one", async () => {
    const adapter = stubAdapter({
      accountName: "X",
      reportBody: "no label",
      reportContentType: "text/html",
      ordersResult: null,
      fillPairsResult: null,
      fillsResult: { count: 8, accountScopedAtApi: true },
    });
    const result = await resolveTradeCount(adapter, { tradingDayKey: TRADING_DAY_KEY });
    const sources = result.attempts.map((a) => a.source);
    assert.deepEqual(sources, [
      "broker_report",
      "account_scoped_orders",
      "account_scoped_fill_pairs",
      "account_scoped_fills",
    ]);
  });

  it("attempt records http status from failed report responses", async () => {
    const adapter = stubAdapter({
      accountName: "X",
      reportBody: "forbidden",
      reportStatus: 403,
      reportContentType: "text/plain",
      unscopedFallback: { count: 12 },
    });
    const result = await resolveTradeCount(adapter, { tradingDayKey: TRADING_DAY_KEY });
    const reportAttempt = result.attempts.find((a) => a.source === "broker_report");
    assert.equal(reportAttempt?.httpStatus, 403);
    assert.equal(reportAttempt?.ok, false);
  });
});
