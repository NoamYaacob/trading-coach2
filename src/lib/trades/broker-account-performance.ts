/**
 * Broker account performance model — pure, no I/O.
 *
 * Derives all account-level analytics strictly from normalized CashHistoryRow[]
 * sourced from cashBalanceLog/deps?masterid={tvAccountId}. The source-of-truth
 * rules enforced here:
 *
 *   1. `delta` is the only per-row value used. `amount` (running balance) and
 *      `realizedPnL` (cumulative session value) are never used as row P&L.
 *
 *   2. Only TradePaired rows count as realized P&L. Fee rows (ExchangeFee,
 *      ClearingFee, NfaFee, Commission) count as cost. All other row types
 *      (FundTransaction, EntitlementSubscription, NewSession, etc.) are
 *      excluded from trading P&L.
 *
 *   3. Account isolation is enforced: cashHistoryDayNet and
 *      aggregateByPairedTrade both filter rows to the supplied accountId.
 *
 *   4. allTimeNet is derived from dayNet (authoritative day sums), not from
 *      tradePairs (which use best-effort per-close fee attribution).
 *
 *   5. Profit factor / win rate / largest win/loss are derived from
 *      TradePaired rows (with attributed fees), not from fill reconstruction.
 *
 *   6. hasBrokerHistory is true only when at least one trading day with fee
 *      data exists. Never set on empty or fee-less Cash History.
 */

import {
  type CashHistoryRow,
  cashHistoryDayNet,
  aggregateByPairedTrade,
  type PairedTradePnl,
} from "./cash-history-fees.ts";

export type { PairedTradePnl };

export type BrokerAccountPerformance = {
  /** "YYYY-MM-DD" → after-fees net. Only days with TradePaired + fee rows. */
  dayNet: Record<string, number>;
  /**
   * Individual TradePaired closes with best-effort attributed fees.
   * Authoritative for win/loss counting and profit factor, but NOT for the
   * total net (use dayNet sum for that — it is the exact day-level aggregate).
   */
  tradePairs: PairedTradePnl[];
  /** Sum of all dayNet values — the authoritative all-time net P&L. */
  allTimeNet: number;
  /** Count of TradePaired closes — individual round-trips, not days. */
  tradeCount: number;
  /** Days where dayNet > 0 (after-fees net). Computed from dayNet, not tradePairs. */
  winCount: number;
  /** Days where dayNet < 0 (after-fees net). Computed from dayNet, not tradePairs. */
  lossCount: number;
  /** Largest positive dayNet value (null when no winning days). */
  largestWin: number | null;
  /** Most negative dayNet value (null when no losing days). */
  largestLoss: number | null;
  /**
   * sum(positive dayNets) / |sum(negative dayNets)|.
   * 0 when winSum=0 but lossSum>0. null when no trading days at all.
   */
  profitFactor: number | null;
  /** True when at least one trading day with fee data exists in Cash History. */
  feesAvailable: boolean;
  /** Alias for feesAvailable — gates broker-native display on all surfaces. */
  hasBrokerHistory: boolean;
  /**
   * Earliest "YYYY-MM-DD" key in dayNet — i.e. the start of API-visible broker
   * history. null when no broker history is available. Use this (not "all-time")
   * to label coverage: "Broker Cash History available from [date]".
   */
  earliestBrokerDay: string | null;
};

/**
 * Aggregated stats for a date window (e.g. last 30 days).
 * Win/loss/PF are derived from dayNet values (authoritative after-fees net).
 * tradeCount is TradePaired row count (individual closes, not days).
 */
export type BrokerWindowStats = {
  /** TradePaired row count in the window — individual closes, not days. */
  tradeCount: number;
  /** Trading days in the window where dayNet > 0. */
  dayCount: number;
  /** Days where dayNet > 0 (after-fees net). */
  winCount: number;
  /** Days where dayNet < 0 (after-fees net). */
  lossCount: number;
  /** winCount / dayCount. null when dayCount === 0. */
  winRate: number | null;
  /**
   * sum(positive dayNets) / |sum(negative dayNets)|.
   * 0 when winSum=0 but lossSum>0. null when no trading days in window.
   */
  profitFactor: number | null;
  /** Largest positive dayNet value in the window. null when no winning days. */
  largestWin: number | null;
  /** Most negative dayNet value in the window. null when no losing days. */
  largestLoss: number | null;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Compute broker account performance from normalized, account-scoped Cash
 * History rows. Pure — no I/O; callers must pass rows already normalized via
 * normalizeCashBalanceLogRows (or equivalent) and scoped to one account.
 *
 * @param rows      Normalized CashHistoryRow[] (may contain rows for any account;
 *                  the inner aggregators enforce strict accountId filtering).
 * @param accountId DB account ID used as the filter key throughout.
 */
export function computeBrokerAccountPerformance(
  rows: CashHistoryRow[],
  accountId: string,
): BrokerAccountPerformance {
  const dayNet = cashHistoryDayNet(rows, accountId);
  const tradePairs = aggregateByPairedTrade(rows, accountId);

  // allTimeNet from the authoritative day-level sums, not per-trade attribution.
  const allTimeNet = round2(Object.values(dayNet).reduce((s, v) => s + v, 0));

  let winCount = 0;
  let lossCount = 0;
  let winSum = 0;
  let lossSum = 0;
  let largestWin: number | null = null;
  let largestLoss: number | null = null;

  // Win/loss/PF from dayNet (authoritative after-fees net), not per-trade attribution.
  for (const net of Object.values(dayNet)) {
    if (net > 0) {
      winCount++;
      winSum += net;
      if (largestWin === null || net > largestWin) largestWin = net;
    } else if (net < 0) {
      lossCount++;
      lossSum += -net; // lossSum is positive magnitude
      if (largestLoss === null || net < largestLoss) largestLoss = net;
    }
  }

  // 0 when winSum=0 but lossSum>0 (all losses); null when no losses or no trading days.
  const profitFactor =
    Object.keys(dayNet).length === 0 ? null : lossSum > 0 ? round2(winSum / lossSum) : null;
  const feesAvailable = Object.keys(dayNet).length > 0;
  const dayNetKeys = Object.keys(dayNet).sort();
  const earliestBrokerDay = dayNetKeys.length > 0 ? dayNetKeys[0]! : null;

  return {
    dayNet,
    tradePairs,
    allTimeNet,
    tradeCount: tradePairs.length,
    winCount,
    lossCount,
    largestWin: largestWin != null ? round2(largestWin) : null,
    largestLoss: largestLoss != null ? round2(largestLoss) : null,
    profitFactor,
    feesAvailable,
    hasBrokerHistory: feesAvailable,
    earliestBrokerDay,
  };
}

/**
 * Compute win/loss statistics for a date window from a BrokerAccountPerformance.
 * `sinceDayKey` is a "YYYY-MM-DD" string; entries before that date are excluded.
 *
 * Win/loss/PF/largestWin/largestLoss use dayNet values (authoritative after-fees
 * day-level net). tradeCount uses TradePaired rows (individual closes).
 */
export function computeBrokerWindowStats(
  perf: BrokerAccountPerformance,
  sinceDayKey: string,
): BrokerWindowStats {
  const windowDayNet = Object.fromEntries(
    Object.entries(perf.dayNet).filter(([date]) => date >= sinceDayKey),
  );
  const windowTrades = perf.tradePairs.filter((tp) => tp.date >= sinceDayKey);

  let winCount = 0;
  let lossCount = 0;
  let winSum = 0;
  let lossSum = 0;
  let largestWin: number | null = null;
  let largestLoss: number | null = null;

  for (const net of Object.values(windowDayNet)) {
    if (net > 0) {
      winCount++;
      winSum += net;
      if (largestWin === null || net > largestWin) largestWin = net;
    } else if (net < 0) {
      lossCount++;
      lossSum += -net;
      if (largestLoss === null || net < largestLoss) largestLoss = net;
    }
  }

  const dayCount = Object.keys(windowDayNet).length;
  const winRate = dayCount > 0 ? round2(winCount / dayCount) : null;
  const profitFactor =
    dayCount === 0 ? null : lossSum > 0 ? round2(winSum / lossSum) : null;

  return {
    tradeCount: windowTrades.length,
    dayCount,
    winCount,
    lossCount,
    winRate,
    profitFactor,
    largestWin: largestWin != null ? round2(largestWin) : null,
    largestLoss: largestLoss != null ? round2(largestLoss) : null,
  };
}

/** Empty/unavailable performance — used as a safe fallback when Cash History fetch fails. */
export const EMPTY_BROKER_PERFORMANCE: BrokerAccountPerformance = {
  dayNet: {},
  tradePairs: [],
  allTimeNet: 0,
  tradeCount: 0,
  winCount: 0,
  lossCount: 0,
  largestWin: null,
  largestLoss: null,
  profitFactor: null,
  feesAvailable: false,
  hasBrokerHistory: false,
  earliestBrokerDay: null,
};
