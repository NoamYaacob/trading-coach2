/**
 * Pure resolution of a day's total P&L for the Trades-page day header.
 *
 * Priority of truth:
 *   1. Broker Cash History net (cashBalanceLog) for that day — authoritative
 *      after-fees net, even when per-trade fee allocation is unavailable.
 *   2. Sum of per-trade net — only when EVERY trade that day carried broker
 *      per-fill fees (feesAvailable).
 *   3. Sum of fill P&L BEFORE fees — labelled as such; never called "Net".
 *
 * This is how the real after-fees day net (e.g. -0.40 for 1868411 / 2026-06-02)
 * reaches the UI even though row-level fees are "Not reported".
 */

export type DayTradeRow = {
  /** Fill/gross P&L (before fees). */
  pnl: number;
  /** Net P&L when per-fill fees are known; equals pnl when they are not. */
  netPnl: number;
  /** True only when this trade carried broker per-fill fee data. */
  feesAvailable: boolean;
};

export type DayNetSource = "broker_net" | "trade_net" | "fill_before_fees";

export type DayNetDisplay = {
  /** The value to show for the day. */
  pnl: number;
  /** Where it came from. */
  source: DayNetSource;
  /** True when `pnl` is a true after-fees net (broker or per-trade). */
  isNet: boolean;
};

/**
 * Resolve the day total. `brokerDayNet` is the cashBalanceLog net for the day
 * (undefined when the broker did not report fees for that day).
 */
export function resolveDayNet(
  rows: DayTradeRow[],
  brokerDayNet: number | undefined,
): DayNetDisplay {
  if (brokerDayNet != null) {
    return { pnl: brokerDayNet, source: "broker_net", isNet: true };
  }
  const dayFeesAvailable = rows.length > 0 && rows.every((t) => t.feesAvailable);
  if (dayFeesAvailable) {
    return { pnl: sum(rows, (t) => t.netPnl), source: "trade_net", isNet: true };
  }
  return { pnl: sum(rows, (t) => t.pnl), source: "fill_before_fees", isNet: false };
}

function sum<T>(arr: T[], pick: (t: T) => number): number {
  return arr.reduce((s, t) => s + pick(t), 0);
}
