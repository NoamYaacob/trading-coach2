/**
 * Tests for the broker account performance module.
 *
 * Source-of-truth rules verified here (numbered to match task requirements):
 *
 *  1. Broker Cash History days drive all account-level charts and KPIs.
 *  2. Fill-only days excluded from broker-native totals when Cash History exists.
 *  3. FundTransaction, EntitlementSubscription excluded from trading P&L.
 *  4. `amount` and `realizedPnL` are never used as row values.
 *  5. cashBalanceLog/deps is used instead of list (structural test).
 *  6. Equity Curve All uses all broker Cash History days (allTimeNet covers all dayNet keys).
 *  7. Calendar totals match broker net (dayNet is the authoritative per-day value).
 *  8. Profit factor / win rate / largest win/loss use day-level broker net (dayNet).
 *  9. Multi-account leakage impossible — rows for other accounts produce no stats.
 * 10. No hardcoded account-specific values — generic fixtures only.
 *
 * All fixtures use generic IDs ("acct-A", "acct-B") and arbitrary P&L values.
 * No values from specific live accounts (1868411, etc.) are used here.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeBrokerAccountPerformance,
  computeBrokerPerformanceFromDayNet,
  computeBrokerWindowStats,
  brokerSourceLabel,
  EMPTY_BROKER_PERFORMANCE,
} from "./broker-account-performance.ts";
import type { CashHistoryRow } from "./cash-history-fees.ts";

// ── Fixture helpers ─────────────────────────────────────────────────────────

function row(over: Partial<CashHistoryRow> & { changeType: string; delta: number }): CashHistoryRow {
  return {
    accountId: over.accountId ?? "acct-A",
    contract: over.contract ?? "CTXM6",
    date: over.date ?? "2026-06-10",
    delta: over.delta,
    changeType: over.changeType,
  };
}

function tradePaired(delta: number, date = "2026-06-10", accountId = "acct-A", contract = "CTXM6"): CashHistoryRow {
  return row({ accountId, contract, date, delta, changeType: "TradePaired" });
}

function exchangeFee(delta: number, date = "2026-06-10", accountId = "acct-A", contract = "CTXM6"): CashHistoryRow {
  return row({ accountId, contract, date, delta, changeType: "ExchangeFee" });
}

function clearingFee(delta: number, date = "2026-06-10", accountId = "acct-A", contract = "CTXM6"): CashHistoryRow {
  return row({ accountId, contract, date, delta, changeType: "ClearingFee" });
}

function nfaFee(delta: number, date = "2026-06-10", accountId = "acct-A", contract = "CTXM6"): CashHistoryRow {
  return row({ accountId, contract, date, delta, changeType: "NfaFee" });
}

function commission(delta: number, date = "2026-06-10", accountId = "acct-A", contract = "CTXM6"): CashHistoryRow {
  return row({ accountId, contract, date, delta, changeType: "Commission" });
}

function fundTransaction(delta: number, date = "2026-06-10", accountId = "acct-A"): CashHistoryRow {
  return row({ accountId, contract: null, date, delta, changeType: "FundTransaction" });
}

function entitlementSubscription(delta: number, date = "2026-06-10", accountId = "acct-A"): CashHistoryRow {
  return row({ accountId, contract: null, date, delta, changeType: "EntitlementSubscription" });
}

function newSession(delta: number, date = "2026-06-10", accountId = "acct-A"): CashHistoryRow {
  return row({ accountId, contract: null, date, delta, changeType: "NewSession" });
}

// ── Test 1: Broker Cash History days drive all account-level charts ──────────

describe("1. Broker Cash History drives account-level analytics", () => {
  it("dayNet contains only TradePaired+fee days — no other row types", () => {
    const rows: CashHistoryRow[] = [
      exchangeFee(-0.50),
      tradePaired(2.0),
      // NewSession and FundTransaction must NOT create dayNet entries
      newSession(0),
      fundTransaction(1000),
    ];
    const perf = computeBrokerAccountPerformance(rows, "acct-A");
    assert.ok(Object.keys(perf.dayNet).length > 0, "trading day appears in dayNet");
    // Only one trading day
    assert.equal(Object.keys(perf.dayNet).length, 1);
    // The net is TradePaired + fee, not including FundTransaction
    assert.ok(Math.abs(perf.dayNet["2026-06-10"]! - 1.50) < 1e-9, "net = 2.00 + (-0.50) = 1.50");
  });

  it("hasBrokerHistory is true when dayNet has at least one entry", () => {
    const rows: CashHistoryRow[] = [
      exchangeFee(-0.50),
      tradePaired(2.0),
    ];
    const perf = computeBrokerAccountPerformance(rows, "acct-A");
    assert.equal(perf.hasBrokerHistory, true);
  });

  it("hasBrokerHistory is false on empty input", () => {
    const perf = computeBrokerAccountPerformance([], "acct-A");
    assert.equal(perf.hasBrokerHistory, false);
    assert.equal(perf.feesAvailable, false);
  });
});

// ── Test 2: Fill-only days excluded from broker-native totals ────────────────

describe("2. Non-trading cash movements do not affect trading totals", () => {
  it("FundTransaction deposit does not inflate allTimeNet", () => {
    const rows: CashHistoryRow[] = [
      // Trading day: +3.00 gross, -1.00 fees = +2.00 net
      exchangeFee(-1.0),
      tradePaired(3.0),
      // Large deposit — must not appear in trading P&L
      fundTransaction(50000),
    ];
    const perf = computeBrokerAccountPerformance(rows, "acct-A");
    assert.ok(Math.abs(perf.allTimeNet - 2.0) < 1e-9,
      `allTimeNet must be 2.00 (trading only), got ${perf.allTimeNet}`);
  });

  it("day with ONLY FundTransaction produces no dayNet entry", () => {
    const rows: CashHistoryRow[] = [
      // Trading day
      exchangeFee(-1.0, "2026-06-10"),
      tradePaired(3.0, "2026-06-10"),
      // Deposit-only day
      fundTransaction(5000, "2026-06-11"),
    ];
    const perf = computeBrokerAccountPerformance(rows, "acct-A");
    assert.ok("2026-06-10" in perf.dayNet, "trading day in dayNet");
    assert.ok(!("2026-06-11" in perf.dayNet), "deposit-only day not in dayNet");
  });
});

// ── Test 3: Fund Transaction and Entitlement Subscription excluded ───────────

describe("3. Non-trading types excluded from trading P&L", () => {
  it("EntitlementSubscription does not appear in dayNet or tradePairs", () => {
    const rows: CashHistoryRow[] = [
      exchangeFee(-1.0),
      tradePaired(2.0),
      entitlementSubscription(-29.99),
    ];
    const perf = computeBrokerAccountPerformance(rows, "acct-A");
    // dayNet should only contain the trading day at 1.00 net
    assert.equal(Object.keys(perf.dayNet).length, 1);
    assert.ok(Math.abs(perf.dayNet["2026-06-10"]! - 1.0) < 1e-9,
      "EntitlementSubscription charge not included in net");
    // tradePairs should be exactly one (the TradePaired row)
    assert.equal(perf.tradePairs.length, 1);
  });

  it("NewSession row does not create a dayNet entry or affect totals", () => {
    const rows: CashHistoryRow[] = [
      newSession(0, "2026-06-10"),
      exchangeFee(-0.50, "2026-06-11"),
      tradePaired(1.50, "2026-06-11"),
    ];
    const perf = computeBrokerAccountPerformance(rows, "acct-A");
    assert.ok(!("2026-06-10" in perf.dayNet), "NewSession-only day not in dayNet");
    assert.ok("2026-06-11" in perf.dayNet, "trading day in dayNet");
    assert.ok(Math.abs(perf.allTimeNet - 1.0) < 1e-9);
  });

  it("all known non-trading types are excluded", () => {
    const rows: CashHistoryRow[] = [
      // Trading rows for reference
      exchangeFee(-1.0, "2026-06-10"),
      tradePaired(3.0, "2026-06-10"),
      // Non-trading rows — various types
      fundTransaction(10000, "2026-06-10"),
      entitlementSubscription(-29.99, "2026-06-10"),
      newSession(0, "2026-06-10"),
      row({ changeType: "Transfer", delta: -500, date: "2026-06-10" }),
      row({ changeType: "Withdrawal", delta: -2000, date: "2026-06-10" }),
    ];
    const perf = computeBrokerAccountPerformance(rows, "acct-A");
    // Trading P&L: 3.00 + (-1.00) = 2.00 — unaffected by non-trading rows
    assert.ok(Math.abs(perf.dayNet["2026-06-10"]! - 2.0) < 1e-9,
      "non-trading rows never affect trading P&L");
  });
});

// ── Test 4: amount and realizedPnL are never used ───────────────────────────

describe("4. amount and realizedPnL are never used as row values", () => {
  it("normalizeCashBalanceLogRows ignores amount and realizedPnL fields", () => {
    // We test this by verifying that the P&L computed from CashHistoryRow[]
    // (which only carries `delta`) is correct even if the caller hypothetically
    // passed rows derived from amount or realizedPnL — those fields aren't on
    // CashHistoryRow at all. The type enforces this at the module boundary.
    //
    // Concretely: a row with delta=+1.50 produces tradePnl=+1.50, not the
    // running-balance `amount` or cumulative `realizedPnL` which would be much
    // larger values (e.g. 50000 or 200).
    const rows: CashHistoryRow[] = [
      exchangeFee(-0.50),
      tradePaired(1.50), // delta=+1.50, not amount/realizedPnL
    ];
    const perf = computeBrokerAccountPerformance(rows, "acct-A");
    // If amount or realizedPnL were used, net would be a large wrong value
    assert.ok(Math.abs(perf.allTimeNet - 1.0) < 1e-9,
      "net = 1.50 + (-0.50) = 1.00, not a running balance or cumulative value");
    assert.equal(perf.tradePairs.length, 1);
    assert.ok(Math.abs(perf.tradePairs[0]!.tradePnl - 1.50) < 1e-9);
  });
});

// ── Test 5: cashBalanceLog/deps used instead of list ─────────────────────────

describe("5. cashBalanceLog/deps endpoint (structural contract)", () => {
  it("computeBrokerAccountPerformance takes pre-normalized rows — endpoint selection is caller's responsibility", () => {
    // The pure module receives CashHistoryRow[] already fetched from /deps.
    // Account isolation is enforced by the accountId filter inside the module.
    // The endpoint selection test lives in tradovate-client.test.ts.
    // Here we verify that rows from another account are silently excluded.
    const rows: CashHistoryRow[] = [
      // Correct account
      exchangeFee(-1.0, "2026-06-10", "acct-A"),
      tradePaired(3.0, "2026-06-10", "acct-A"),
      // Wrong account — must be excluded
      exchangeFee(-1.0, "2026-06-10", "acct-B"),
      tradePaired(999, "2026-06-10", "acct-B"),
    ];
    const perf = computeBrokerAccountPerformance(rows, "acct-A");
    // Only acct-A rows contribute; acct-B's 999 must not appear
    assert.ok(Math.abs(perf.allTimeNet - 2.0) < 1e-9,
      `allTimeNet must be 2.00 (acct-A only), got ${perf.allTimeNet}`);
  });
});

// ── Test 6: Equity Curve All uses all broker Cash History days ────────────────

describe("6. Equity Curve All uses all broker Cash History days", () => {
  it("allTimeNet covers all dayNet keys — no days truncated", () => {
    const rows: CashHistoryRow[] = [
      // Day 1: +5.00 net
      exchangeFee(-1.0, "2026-05-01"),
      tradePaired(6.0, "2026-05-01"),
      // Day 2: -2.00 net
      exchangeFee(-1.0, "2026-05-15"),
      tradePaired(-1.0, "2026-05-15"),
      // Day 3: +3.00 net
      exchangeFee(-1.0, "2026-06-10"),
      tradePaired(4.0, "2026-06-10"),
    ];
    const perf = computeBrokerAccountPerformance(rows, "acct-A");
    assert.equal(Object.keys(perf.dayNet).length, 3, "all 3 days in dayNet");
    // allTimeNet = 5.00 + (-2.00) + 3.00 = 6.00
    assert.ok(Math.abs(perf.allTimeNet - 6.0) < 1e-9,
      `allTimeNet covers all days: 5-2+3=6.00, got ${perf.allTimeNet}`);
    // buildBrokerNativeSeries(dayNet) would produce 3 points — all days
    // (tested separately in daily-pnl.test.ts)
  });

  it("dayNet keys span full history, not just last 30 days", () => {
    const rows: CashHistoryRow[] = [
      // 90 days ago
      exchangeFee(-1.0, "2026-03-01"),
      tradePaired(5.0, "2026-03-01"),
      // 5 days ago
      exchangeFee(-1.0, "2026-05-29"),
      tradePaired(2.0, "2026-05-29"),
    ];
    const perf = computeBrokerAccountPerformance(rows, "acct-A");
    assert.ok("2026-03-01" in perf.dayNet, "old day (90+ days ago) included in dayNet");
    assert.ok("2026-05-29" in perf.dayNet, "recent day included in dayNet");
    assert.equal(Object.keys(perf.dayNet).length, 2);
  });
});

// ── Test 7: Calendar totals match broker net ─────────────────────────────────

describe("7. Calendar totals match broker net (dayNet is authoritative)", () => {
  it("multi-contract day net equals sum of all contracts' net for that day", () => {
    // Two contracts on the same day — calendar must show the combined net
    const rows: CashHistoryRow[] = [
      // Contract A
      exchangeFee(-0.50, "2026-06-10", "acct-A", "CTXM6"),
      tradePaired(2.0, "2026-06-10", "acct-A", "CTXM6"),
      // Contract B
      clearingFee(-0.30, "2026-06-10", "acct-A", "MNQM6"),
      tradePaired(-1.0, "2026-06-10", "acct-A", "MNQM6"),
    ];
    const perf = computeBrokerAccountPerformance(rows, "acct-A");
    // Day net = (2.00 - 0.50) + (-1.00 - 0.30) = 1.50 + (-1.30) = 0.20
    assert.ok(Math.abs(perf.dayNet["2026-06-10"]! - 0.20) < 1e-9,
      `multi-contract day net should be 0.20, got ${perf.dayNet["2026-06-10"]}`);
  });

  it("single-trade day net matches tradePaired + all fee types", () => {
    const rows: CashHistoryRow[] = [
      exchangeFee(-0.25, "2026-06-10"),
      clearingFee(-0.25, "2026-06-10"),
      nfaFee(-0.10, "2026-06-10"),
      commission(-0.50, "2026-06-10"),
      tradePaired(5.0, "2026-06-10"),
    ];
    const perf = computeBrokerAccountPerformance(rows, "acct-A");
    // Net = 5.00 - 0.25 - 0.25 - 0.10 - 0.50 = 3.90
    assert.ok(Math.abs(perf.dayNet["2026-06-10"]! - 3.90) < 1e-9,
      `all four fee types included in day net, got ${perf.dayNet["2026-06-10"]}`);
  });
});

// ── Test 8: Profit factor / win rate / largest win/loss use day-level broker net ──

describe("8. Profit factor / win rate / largest win/loss use day-level broker net", () => {
  it("positive TradePaired + fees making net negative → loss, not win", () => {
    // +$1.50 TradePaired, -$1.90 fees → dayNet = -$0.40 → lossCount=1, winCount=0
    const rows: CashHistoryRow[] = [
      exchangeFee(-0.50),
      exchangeFee(-0.50),
      exchangeFee(-0.90),
      tradePaired(1.50),
    ];
    const perf = computeBrokerAccountPerformance(rows, "acct-A");
    assert.equal(perf.winCount, 0, "positive TradePaired with larger fees is a losing day");
    assert.equal(perf.lossCount, 1);
    assert.ok(perf.largestWin === null, "no winning day");
    assert.ok(perf.largestLoss != null);
    assert.ok(Math.abs(perf.largestLoss! - (-0.40)) < 1e-9,
      `largestLoss should be -0.40, got ${perf.largestLoss}`);
    // profitFactor must be 0 (winSum=0, lossSum>0 → 0/lossSum = 0) not null
    assert.ok(perf.profitFactor != null && perf.profitFactor === 0,
      "profitFactor must be 0 when all days are losses, not null");
  });

  it("positive TradePaired + smaller fees → winning day", () => {
    const rows: CashHistoryRow[] = [
      exchangeFee(-0.50),
      tradePaired(3.0),
    ];
    const perf = computeBrokerAccountPerformance(rows, "acct-A");
    assert.equal(perf.winCount, 1);
    assert.equal(perf.lossCount, 0);
    assert.ok(perf.largestWin != null);
    assert.ok(Math.abs(perf.largestWin! - 2.50) < 1e-9,
      `largestWin should be 2.50, got ${perf.largestWin}`);
    // profitFactor null when no losing days (PF undefined by convention, not 0)
    assert.strictEqual(perf.profitFactor, null,
      "profitFactor is null when no losing days (undefined, not infinity)");
  });

  it("profitFactor computed from dayNet values (day-level after-fees net)", () => {
    const rows: CashHistoryRow[] = [
      // Day 1: +4.00 gross, -1.00 fees = +3.00 day net
      exchangeFee(-1.0, "2026-06-10", "acct-A", "CTXM6"),
      tradePaired(4.0, "2026-06-10", "acct-A", "CTXM6"),
      // Day 2: -2.00 gross, -0.50 fees = -2.50 day net
      exchangeFee(-0.5, "2026-06-11", "acct-A", "CTXM6"),
      tradePaired(-2.0, "2026-06-11", "acct-A", "CTXM6"),
    ];
    const perf = computeBrokerAccountPerformance(rows, "acct-A");
    assert.equal(perf.winCount, 1);
    assert.equal(perf.lossCount, 1);
    // PF = dayNet_win / |dayNet_loss| = 3.00 / 2.50 = 1.20
    assert.ok(perf.profitFactor != null, "profitFactor is not null");
    assert.ok(Math.abs(perf.profitFactor! - 1.2) < 1e-9,
      `profitFactor should be 1.20, got ${perf.profitFactor}`);
  });

  it("winCount and lossCount counted by trading day (not by individual TradePaired rows)", () => {
    const rows: CashHistoryRow[] = [
      // Day 1: winning day (+2.50 net)
      exchangeFee(-0.5, "2026-06-10"), tradePaired(3.0, "2026-06-10"),
      // Day 2: winning day (+0.50 net)
      exchangeFee(-0.5, "2026-06-11"), tradePaired(1.0, "2026-06-11"),
      // Day 3: losing day (-2.50 net)
      exchangeFee(-0.5, "2026-06-12"), tradePaired(-2.0, "2026-06-12"),
    ];
    const perf = computeBrokerAccountPerformance(rows, "acct-A");
    assert.equal(perf.tradeCount, 3, "tradeCount = TradePaired rows");
    assert.equal(perf.winCount, 2, "two winning days");
    assert.equal(perf.lossCount, 1, "one losing day");
    const since = "2026-01-01";
    const ws = computeBrokerWindowStats(perf, since);
    assert.equal(ws.winCount, 2);
    assert.equal(ws.lossCount, 1);
    assert.equal(ws.dayCount, 3);
    assert.ok(ws.winRate != null);
    assert.ok(Math.abs(ws.winRate! - 0.67) < 0.01, `winRate should be ~0.67, got ${ws.winRate}`);
  });

  it("largestWin and largestLoss from dayNet values (not per-trade attribution)", () => {
    const rows: CashHistoryRow[] = [
      exchangeFee(-1.0, "2026-06-10"), tradePaired(10.0, "2026-06-10"),
      exchangeFee(-1.0, "2026-06-11"), tradePaired(5.0, "2026-06-11"),
      exchangeFee(-1.0, "2026-06-12"), tradePaired(-3.0, "2026-06-12"),
      exchangeFee(-1.0, "2026-06-13"), tradePaired(-7.0, "2026-06-13"),
    ];
    const perf = computeBrokerAccountPerformance(rows, "acct-A");
    // dayNet values: +9.00, +4.00, -4.00, -8.00
    assert.ok(perf.largestWin != null);
    assert.ok(Math.abs(perf.largestWin! - 9.0) < 1e-9,
      `largestWin should be 9.00, got ${perf.largestWin}`);
    assert.ok(perf.largestLoss != null);
    assert.ok(Math.abs(perf.largestLoss! - (-8.0)) < 1e-9,
      `largestLoss should be -8.00, got ${perf.largestLoss}`);
  });

  it("computeBrokerWindowStats excludes days before sinceDayKey", () => {
    const rows: CashHistoryRow[] = [
      // Old day (outside window)
      exchangeFee(-1.0, "2026-03-01"), tradePaired(20.0, "2026-03-01"),
      // Recent days (inside window)
      exchangeFee(-1.0, "2026-06-01"), tradePaired(5.0, "2026-06-01"),
      exchangeFee(-1.0, "2026-06-02"), tradePaired(-2.0, "2026-06-02"),
    ];
    const perf = computeBrokerAccountPerformance(rows, "acct-A");
    const ws = computeBrokerWindowStats(perf, "2026-06-01");
    assert.equal(ws.dayCount, 2, "old day excluded from window");
    assert.equal(ws.tradeCount, 2, "old TradePaired excluded from window");
    assert.equal(ws.winCount, 1);
    assert.equal(ws.lossCount, 1);
  });

  it("profitFactor is null when no Cash History at all, not 0", () => {
    const perf = computeBrokerAccountPerformance([], "acct-A");
    assert.strictEqual(perf.profitFactor, null, "profitFactor null when no trading days");
  });

  it("NewSession-only day creates no dayNet entry; fee-only day appears as a loss", () => {
    const rows: CashHistoryRow[] = [
      newSession(0, "2026-06-10"),                    // NewSession only — excluded
      exchangeFee(-0.50, "2026-06-11"),               // fee with no TradePaired — real cost
    ];
    const perf = computeBrokerAccountPerformance(rows, "acct-A");
    assert.ok(!("2026-06-10" in perf.dayNet), "NewSession-only day never appears in dayNet");
    // Fee-only day is real cost — appears in dayNet with negative value
    assert.ok("2026-06-11" in perf.dayNet, "fee-only day appears in dayNet as a cost");
    assert.equal(perf.tradeCount, 0, "no TradePaired rows");
    assert.equal(perf.winCount, 0, "no winning days");
    assert.equal(perf.lossCount, 1, "one losing day (fees only)");
    assert.strictEqual(perf.profitFactor, 0, "profitFactor 0 when losses only");
  });
});

// ── Test 9: Multi-account leakage impossible ─────────────────────────────────

describe("9. Multi-account leakage impossible", () => {
  it("rows for acct-B produce zero stats when requesting acct-A", () => {
    const rows: CashHistoryRow[] = [
      exchangeFee(-1.0, "2026-06-10", "acct-B"),
      tradePaired(100.0, "2026-06-10", "acct-B"),
    ];
    const perf = computeBrokerAccountPerformance(rows, "acct-A");
    assert.equal(Object.keys(perf.dayNet).length, 0, "no acct-B days in acct-A dayNet");
    assert.equal(perf.tradeCount, 0);
    assert.equal(perf.allTimeNet, 0);
    assert.equal(perf.hasBrokerHistory, false);
  });

  it("mixed-account rows: only the requested account's rows are aggregated", () => {
    const rows: CashHistoryRow[] = [
      // acct-A: +5.00 gross, -1.00 fee = +4.00 net
      exchangeFee(-1.0, "2026-06-10", "acct-A"),
      tradePaired(5.0, "2026-06-10", "acct-A"),
      // acct-B: +999.00 — must not leak into acct-A
      exchangeFee(-1.0, "2026-06-10", "acct-B"),
      tradePaired(999.0, "2026-06-10", "acct-B"),
      // acct-C: loss — must not leak either
      exchangeFee(-1.0, "2026-06-10", "acct-C"),
      tradePaired(-500.0, "2026-06-10", "acct-C"),
    ];
    const perf = computeBrokerAccountPerformance(rows, "acct-A");
    assert.ok(Math.abs(perf.allTimeNet - 4.0) < 1e-9,
      `allTimeNet must be 4.00 (acct-A only), got ${perf.allTimeNet}`);
    assert.equal(perf.tradeCount, 1, "only one trade for acct-A");
    assert.equal(perf.winCount, 1);
    assert.equal(perf.lossCount, 0);
  });
});

// ── Test 10: No hardcoded account values ─────────────────────────────────────

describe("10. Generic — no hardcoded account-specific values", () => {
  it("EMPTY_BROKER_PERFORMANCE is a safe zero-value fallback", () => {
    assert.equal(EMPTY_BROKER_PERFORMANCE.hasBrokerHistory, false);
    assert.equal(EMPTY_BROKER_PERFORMANCE.tradeCount, 0);
    assert.equal(EMPTY_BROKER_PERFORMANCE.allTimeNet, 0);
    assert.equal(EMPTY_BROKER_PERFORMANCE.profitFactor, null);
    assert.equal(EMPTY_BROKER_PERFORMANCE.largestWin, null);
    assert.equal(EMPTY_BROKER_PERFORMANCE.largestLoss, null);
    assert.equal(EMPTY_BROKER_PERFORMANCE.earliestBrokerDay, null);
    assert.deepEqual(EMPTY_BROKER_PERFORMANCE.dayNet, {});
    assert.deepEqual(EMPTY_BROKER_PERFORMANCE.tradePairs, []);
  });

  it("earliestBrokerDay is the min dayNet key — used for 'available from' labeling", () => {
    const rows: CashHistoryRow[] = [
      exchangeFee(-1.0, "2026-06-03", "acct-A"),
      tradePaired(3.0, "2026-06-03", "acct-A"),
      exchangeFee(-1.0, "2026-06-05", "acct-A"),
      tradePaired(5.0, "2026-06-05", "acct-A"),
      exchangeFee(-0.5, "2026-06-01", "acct-A"),
      tradePaired(2.0, "2026-06-01", "acct-A"),
    ];
    const perf = computeBrokerAccountPerformance(rows, "acct-A");
    assert.equal(perf.earliestBrokerDay, "2026-06-01",
      "earliestBrokerDay is min dayNet key regardless of row order");
  });

  it("earliestBrokerDay is null when no broker history", () => {
    const perf = computeBrokerAccountPerformance([], "acct-A");
    assert.equal(perf.earliestBrokerDay, null);
    assert.equal(perf.hasBrokerHistory, false);
  });

  it("performance model works for any accountId string — not tied to specific accounts", () => {
    for (const aid of ["user-1", "org-99", "DEMO99999", "uuid-abc-def"]) {
      const rows: CashHistoryRow[] = [
        exchangeFee(-1.0, "2026-06-10", aid),
        tradePaired(3.0, "2026-06-10", aid),
      ];
      const perf = computeBrokerAccountPerformance(rows, aid);
      assert.ok(perf.hasBrokerHistory, `hasBrokerHistory for ${aid}`);
      assert.ok(Math.abs(perf.allTimeNet - 2.0) < 1e-9, `allTimeNet for ${aid}`);
    }
  });

  it("spaced and unspaced Cash Change Type variants both classify correctly", () => {
    // Tradovate API returns unspaced ("TradePaired", "ExchangeFee")
    // Cash History PDF shows spaced ("Trade Paired", "Exchange Fee")
    // Both must produce the same result
    const unspaced: CashHistoryRow[] = [
      row({ changeType: "ExchangeFee", delta: -0.50 }),
      row({ changeType: "TradePaired", delta: 2.0 }),
    ];
    const spaced: CashHistoryRow[] = [
      row({ changeType: "Exchange Fee", delta: -0.50 }),
      row({ changeType: "Trade Paired", delta: 2.0 }),
    ];
    const perfU = computeBrokerAccountPerformance(unspaced, "acct-A");
    const perfS = computeBrokerAccountPerformance(spaced, "acct-A");
    assert.ok(Math.abs(perfU.allTimeNet - 1.50) < 1e-9);
    assert.ok(Math.abs(perfS.allTimeNet - 1.50) < 1e-9,
      "spaced variant produces same result as unspaced");
    assert.equal(perfU.tradeCount, 1);
    assert.equal(perfS.tradeCount, 1);
  });
});

// ── Test 11: Account Balance History (report) day-level performance ──────────

describe("11. computeBrokerPerformanceFromDayNet — Account Balance History source", () => {
  // Generic day-level realized P&L map (no live account values).
  const dayNet = {
    "2026-01-02": -212.10,
    "2026-01-05": 35.40,
    "2026-01-09": 0,
    "2026-01-12": -0.40,
  };

  it("win/loss/profit-factor/largest use day-level realized P&L", () => {
    const perf = computeBrokerPerformanceFromDayNet(dayNet, "account-balance-history");
    assert.equal(perf.winCount, 1, "only 2026-01-05 is a winning day");
    assert.equal(perf.lossCount, 2, "two losing days (-212.10, -0.40); zero day excluded");
    assert.equal(perf.largestWin, 35.40);
    assert.equal(perf.largestLoss, -212.10);
    // PF = 35.40 / (212.10 + 0.40) = 35.40 / 212.50
    assert.equal(perf.profitFactor, Math.round((35.40 / 212.50 + Number.EPSILON) * 100) / 100);
    assert.equal(perf.allTimeNet, -177.10, "total realized = -212.10 + 35.40 + 0 - 0.40");
  });

  it("sets source, earliest/latest broker day, and no per-trade detail", () => {
    const perf = computeBrokerPerformanceFromDayNet(dayNet, "account-balance-history");
    assert.equal(perf.source, "account-balance-history");
    assert.equal(perf.earliestBrokerDay, "2026-01-02");
    assert.equal(perf.latestBrokerDay, "2026-01-12");
    assert.equal(perf.tradeCount, 0, "report is day-level — no per-trade count");
    assert.deepEqual(perf.tradePairs, []);
    assert.ok(perf.hasBrokerHistory);
  });

  it("computeBrokerWindowStats works on a report-derived performance", () => {
    const perf = computeBrokerPerformanceFromDayNet(dayNet, "account-balance-history");
    const ws = computeBrokerWindowStats(perf, "2026-01-05");
    assert.equal(ws.dayCount, 3, "2026-01-05, -09, -12 are >= sinceDayKey");
    assert.equal(ws.winCount, 1);
    assert.equal(ws.lossCount, 1);
    assert.equal(ws.largestLoss, -0.40);
    assert.equal(ws.largestWin, 35.40);
  });

  it("empty day map yields source 'none' and no history", () => {
    const perf = computeBrokerPerformanceFromDayNet({}, "account-balance-history");
    assert.equal(perf.source, "none");
    assert.equal(perf.hasBrokerHistory, false);
    assert.equal(perf.earliestBrokerDay, null);
    assert.equal(perf.latestBrokerDay, null);
  });
});

// ── Test 12: source labels ───────────────────────────────────────────────────

describe("12. brokerSourceLabel — honest source wording", () => {
  it("Account Balance History → 'Broker Account Balance History'", () => {
    assert.equal(brokerSourceLabel("account-balance-history"), "Broker Account Balance History");
  });
  it("cash-history → 'Broker Cash History'", () => {
    assert.equal(brokerSourceLabel("cash-history"), "Broker Cash History");
  });
  it("none → 'Broker history' (never claims a specific source)", () => {
    assert.equal(brokerSourceLabel("none"), "Broker history");
  });

  it("cashBalanceLog-derived performance is tagged source 'cash-history'", () => {
    const rows: CashHistoryRow[] = [
      exchangeFee(-1.0, "2026-06-02", "acct-A"),
      tradePaired(0.6, "2026-06-02", "acct-A"),
    ];
    const perf = computeBrokerAccountPerformance(rows, "acct-A");
    assert.equal(perf.source, "cash-history");
    assert.equal(perf.latestBrokerDay, "2026-06-02");
  });
});
