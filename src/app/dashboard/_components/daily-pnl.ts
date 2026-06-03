/**
 * Pure DAILY / account-level P&L aggregation for dashboard analytics.
 *
 * The equity curve and max-drawdown are account-level analytics: their natural
 * unit is the trading DAY, not the individual fill. When the broker reports a
 * Cash History (cashBalanceLog) net for a day, that after-fees net is the
 * source of truth for that day — it must override the fill-derived gross sum.
 *
 * Example — account 1868411 / 2026-06-02:
 *   fill P&L = +1.50, fees = -1.90, broker day net = -0.40.
 *   The daily series value for that day is -0.40, NOT +1.50.
 *
 * Honesty rules (mirrors the calendar):
 *   - Broker net is used ONLY for days the broker reported AND that contain
 *     trades in the window (never fabricated, never a phantom day).
 *   - When NO day in the window carries a broker net AND per-fill fees are
 *     missing, the whole series is fill P&L before fees — callers must label
 *     it as such and never call it "Net".
 *   - We never silently mix gross fill P&L with cash-history net on the same
 *     surface without flagging it: `allDaysNet` is true only when every day
 *     in the series is a true after-fees net.
 *
 * Account isolation: callers pass trades + brokerDayNet already scoped to one
 * account. This module performs no cross-account mixing.
 */

import type { RoundTripTrade } from "@/lib/trades/round-trips";

import { aggregateCalendarDays } from "./pnl-calendar-agg.ts";

export type DailyPnlPoint = {
  /** "YYYY-MM-DD" key in the supplied timezone. */
  day: string;
  /** Day P&L: broker net when reported for the day, else fill/per-trade sum. */
  pnl: number;
  /** Running cumulative of `pnl` across the chronological series. */
  cumulative: number;
  /** True when this day's `pnl` is a broker-reported after-fees net. */
  brokerNet: boolean;
};

export type DailySeries = {
  points: DailyPnlPoint[];
  /** True only when EVERY day in the series is a true after-fees net. */
  allDaysNet: boolean;
  /**
   * True when AT LEAST ONE day in the series is a broker-reported after-fees
   * net. Lets a mixed range be labelled honestly ("broker net where available")
   * instead of falsely implying the whole curve is gross fill before fees.
   */
  someBrokerNet: boolean;
};

/**
 * Build the chronological daily P&L series for account-level analytics.
 *
 * @param trades        round-trips already scoped to the account + window
 * @param timezone      IANA tz used for the day key (e.g. "America/Chicago")
 * @param feesAvailable true when every trade carried broker per-fill fees
 * @param brokerDayNet  cashBalanceLog net per day key (authoritative when set)
 */
export function buildDailySeries(
  trades: RoundTripTrade[],
  timezone: string,
  feesAvailable: boolean,
  brokerDayNet?: Record<string, number>,
): DailySeries {
  const dayMap = aggregateCalendarDays(trades, timezone, feesAvailable, brokerDayNet);
  const days = [...dayMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  let cum = 0;
  const points: DailyPnlPoint[] = days.map(([day, agg]) => {
    cum += agg.pnl;
    return {
      day,
      pnl: agg.pnl,
      cumulative: Number(cum.toFixed(2)),
      brokerNet: agg.brokerNet,
    };
  });

  // True net only when every day resolved to a true after-fees net — either a
  // broker-reported day net, or window-wide per-fill fees.
  const allDaysNet =
    points.length > 0 && (feesAvailable || points.every((p) => p.brokerNet));
  // Per-fill fees make every day a true net; a single broker-net day also counts.
  const someBrokerNet =
    points.length > 0 && (feesAvailable || points.some((p) => p.brokerNet));

  return { points, allDaysNet, someBrokerNet };
}

/**
 * Max drawdown across the DAILY cumulative curve. Returns 0 for an empty or
 * strictly-non-decreasing curve. Uses the same broker-net-aware day values as
 * the equity curve, so the two surfaces never disagree.
 */
export function dailyMaxDrawdown(series: DailySeries): number {
  let peak = 0;
  let dd = 0;
  for (const p of series.points) {
    if (p.cumulative > peak) peak = p.cumulative;
    const drop = peak - p.cumulative;
    if (drop > dd) dd = drop;
  }
  return dd;
}
