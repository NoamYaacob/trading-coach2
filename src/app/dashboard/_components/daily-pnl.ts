/**
 * Pure DAILY / account-level P&L aggregation for dashboard analytics.
 *
 * The equity curve and max-drawdown are account-level analytics: their natural
 * unit is the trading DAY, not the individual fill. When the broker reports a
 * Cash History (cashBalanceLog) net for a day, that after-fees net is the
 * source of truth for that day — it must override the fill-derived gross sum.
 *
 * Two build paths:
 *
 *   buildBrokerNativeSeries (primary):
 *     When cashBalanceLog data is available, use it as the sole source of
 *     truth for the equity curve and max drawdown. This covers the full
 *     account history — all days the broker reported — without being limited
 *     to the fill-import window. Every point is allDaysNet=true.
 *
 *   buildDailySeries (fill-based fallback):
 *     Used when cashBalanceLog is empty (e.g. no broker session yet). Builds
 *     from imported fills, overriding any individual day that has a broker net.
 *     Honestly labelled as partial imported fills when broker data is absent.
 *
 * Example — account 1868411 / 2026-06-02:
 *   cashBalanceLog: Trade Paired +1.50, fees -1.90, day net = -0.40.
 *   buildBrokerNativeSeries uses -0.40. Never +1.50.
 *
 * Account isolation: callers pass brokerDayNet already scoped to one account.
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
 * Build the daily P&L series PURELY from broker Cash History (cashBalanceLog)
 * day nets. This is the preferred path when broker data is available — it
 * covers the full account history without being limited to the fill-import
 * window, and every point is a confirmed after-fees net.
 *
 * @param brokerDayNet  cashBalanceLog net per "YYYY-MM-DD" key (full history)
 * @param sinceDayKey   optional "YYYY-MM-DD" cutoff — only days >= this key
 *                      are included (for windowed views like 7D/14D/30D)
 */
export function buildBrokerNativeSeries(
  brokerDayNet: Record<string, number>,
  sinceDayKey?: string,
): DailySeries {
  let days = Object.entries(brokerDayNet)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (sinceDayKey != null) {
    days = days.filter(([day]) => day >= sinceDayKey);
  }
  let cum = 0;
  const points: DailyPnlPoint[] = days.map(([day, pnl]) => {
    cum = round2(cum + pnl);
    return { day, pnl, cumulative: cum, brokerNet: true };
  });
  return {
    points,
    allDaysNet: points.length > 0,
    someBrokerNet: points.length > 0,
  };
}

/**
 * Build the chronological daily P&L series from imported fills, with broker
 * Cash History overriding individual days where available. Use as fallback when
 * broker history is absent; prefer buildBrokerNativeSeries otherwise.
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

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
