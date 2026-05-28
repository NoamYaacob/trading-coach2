/**
 * Pure trader-insight helpers operating on a per-account
 * `RoundTripTrade[]` array.
 *
 * Every helper is safe on empty input and returns `null` (or `0`/empty
 * results, as documented per function) when there is not enough data to
 * produce an honest answer.  No I/O, no React — used by both server and
 * client components and unit-tested with `node:test`.
 *
 * Account isolation: callers must pass trades already filtered for the
 * selected account.  These helpers do not cross-mix accounts.
 */

import type { RoundTripTrade } from "@/lib/trades/round-trips";

/**
 * Maximum drawdown across the chronological cumulative P&L curve.
 * Returns 0 for empty input or a strictly-non-decreasing curve.
 */
export function maxDrawdown(trades: RoundTripTrade[]): number {
  if (trades.length === 0) return 0;
  const chrono = [...trades].sort(
    (a, b) => a.closedAt.getTime() - b.closedAt.getTime(),
  );
  let peak = 0;
  let cum = 0;
  let dd = 0;
  for (const t of chrono) {
    cum += t.pnl;
    if (cum > peak) peak = cum;
    const drop = peak - cum;
    if (drop > dd) dd = drop;
  }
  return dd;
}

/**
 * Gross wins / gross losses (absolute).  Returns `null` when there are no
 * losing trades — profit factor is undefined in that case rather than
 * "infinity".  Also returns `null` for empty input.
 */
export function profitFactor(trades: RoundTripTrade[]): number | null {
  let wins = 0;
  let losses = 0;
  for (const t of trades) {
    if (t.pnl > 0) wins += t.pnl;
    else if (t.pnl < 0) losses += -t.pnl;
  }
  if (losses === 0) return null;
  return wins / losses;
}

/**
 * Mean P&L per trade.  Returns `null` for empty input.
 */
export function expectancy(trades: RoundTripTrade[]): number | null {
  if (trades.length === 0) return null;
  return trades.reduce((s, t) => s + t.pnl, 0) / trades.length;
}

export type DowStats = {
  dow: number;
  label: string;
  pnl: number;
  count: number;
};

/**
 * Aggregate P&L by day-of-week using a real Intl-based weekday computation
 * in the supplied timezone.  Always returns 7 buckets in Sun→Sat order.
 */
export function pnlByDayOfWeek(
  trades: RoundTripTrade[],
  tz: string,
): DowStats[] {
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const buckets: DowStats[] = labels.map((label, dow) => ({
    dow,
    label,
    pnl: 0,
    count: 0,
  }));
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  });
  for (const t of trades) {
    const wd = fmt.format(t.closedAt);
    const idx = labels.indexOf(wd);
    if (idx >= 0) {
      buckets[idx]!.pnl += t.pnl;
      buckets[idx]!.count += 1;
    }
  }
  return buckets;
}

export type HourStats = { hour: number; pnl: number; count: number };

/**
 * Aggregate P&L by hour-of-day in the supplied timezone.  Always returns
 * 24 buckets in chronological hour order (0..23).
 */
export function pnlByHourOfDay(
  trades: RoundTripTrade[],
  tz: string,
): HourStats[] {
  const buckets: HourStats[] = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    pnl: 0,
    count: 0,
  }));
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    hour12: false,
  });
  for (const t of trades) {
    const hourStr = fmt.format(t.closedAt);
    const h = parseInt(hourStr, 10) % 24;
    if (!Number.isNaN(h) && h >= 0 && h < 24) {
      buckets[h]!.pnl += t.pnl;
      buckets[h]!.count += 1;
    }
  }
  return buckets;
}

/**
 * The single largest positive-P&L trade, or `null` when there are no
 * winners.
 */
export function biggestWin(trades: RoundTripTrade[]): RoundTripTrade | null {
  if (trades.length === 0) return null;
  let best: RoundTripTrade | null = null;
  for (const t of trades) {
    if (t.pnl > 0 && (best == null || t.pnl > best.pnl)) best = t;
  }
  return best;
}

/**
 * The single largest negative-P&L trade, or `null` when there are no
 * losers.
 */
export function biggestLoss(trades: RoundTripTrade[]): RoundTripTrade | null {
  if (trades.length === 0) return null;
  let worst: RoundTripTrade | null = null;
  for (const t of trades) {
    if (t.pnl < 0 && (worst == null || t.pnl < worst.pnl)) worst = t;
  }
  return worst;
}
