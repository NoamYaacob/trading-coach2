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
  /** Count of TradePaired closes — proxy for completed round-trips. */
  tradeCount: number;
  /** TradePaired closes where netPnl > 0 (after attributed fees). */
  winCount: number;
  /** TradePaired closes where netPnl < 0 (after attributed fees). */
  lossCount: number;
  /** Largest single TradePaired netPnl (null when no winning closes). */
  largestWin: number | null;
  /** Most negative single TradePaired netPnl (null when no losing closes). */
  largestLoss: number | null;
  /**
   * Gross win sum / |gross loss sum| from TradePaired netPnl values.
   * null when there are no losing closes (undefined by convention, not ∞).
   */
  profitFactor: number | null;
  /** True when at least one trading day with fee data exists in Cash History. */
  feesAvailable: boolean;
  /** Alias for feesAvailable — gates broker-native display on all surfaces. */
  hasBrokerHistory: boolean;
};

/**
 * Aggregated stats for a date window (e.g. last 30 days).
 * Derived from TradePaired rows so profit factor reflects after-fees closes.
 */
export type BrokerWindowStats = {
  tradeCount: number;
  winCount: number;
  lossCount: number;
  /** winCount / tradeCount. null when tradeCount === 0. */
  winRate: number | null;
  /** sum(winners) / |sum(losers)|. null when no losers. */
  profitFactor: number | null;
  /** Largest single TradePaired netPnl in the window. null when no winners. */
  largestWin: number | null;
  /** Most negative single TradePaired netPnl in window. null when no losers. */
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

  for (const tp of tradePairs) {
    const net = tp.netPnl;
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

  const profitFactor = lossSum > 0 ? round2(winSum / lossSum) : null;
  const feesAvailable = Object.keys(dayNet).length > 0;

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
  };
}

/**
 * Compute win/loss statistics for a date window from TradePaired rows.
 * `sinceDayKey` is a "YYYY-MM-DD" string; rows with date < sinceDayKey are excluded.
 * Generic — works for any window (7D, 30D, etc.).
 */
export function computeBrokerWindowStats(
  tradePairs: PairedTradePnl[],
  sinceDayKey: string,
): BrokerWindowStats {
  const window = tradePairs.filter((tp) => tp.date >= sinceDayKey);

  let winCount = 0;
  let lossCount = 0;
  let winSum = 0;
  let lossSum = 0;
  let largestWin: number | null = null;
  let largestLoss: number | null = null;

  for (const tp of window) {
    const net = tp.netPnl;
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

  const tradeCount = window.length;
  const winRate = tradeCount > 0 ? round2(winCount / tradeCount) : null;
  const profitFactor = lossSum > 0 ? round2(winSum / lossSum) : null;

  return {
    tradeCount,
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
};
