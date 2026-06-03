import type { RoundTripTrade } from "@/lib/trades/round-trips";

export type CalendarDayAgg = { pnl: number; count: number; brokerNet: boolean };

/**
 * Pure daily aggregation for the P&L calendar. For each displayed-timezone day:
 *   - If `brokerDayNet` carries that day's key, the cell P&L is the broker's
 *     authoritative net-after-fees (and brokerNet=true).
 *   - Otherwise it's the sum of per-trade net (when window fees are known) or
 *     fill P&L before fees.
 *
 * Never fabricates: broker net is used only for days the broker reported, and
 * only when those days actually contain trades in the window.
 *
 * Extracted from pnl-calendar.tsx so it can be unit-tested without JSX (the
 * node test runner's type-stripping does not parse JSX).
 */
export function aggregateCalendarDays(
  trades: RoundTripTrade[],
  timezone: string,
  feesAvailable: boolean,
  brokerDayNet?: Record<string, number>,
): Map<string, CalendarDayAgg> {
  const map = new Map<string, CalendarDayAgg>();
  for (const t of trades) {
    const key = t.closedAt.toLocaleDateString("en-CA", { timeZone: timezone });
    const cur = map.get(key) ?? { pnl: 0, count: 0, brokerNet: false };
    map.set(key, {
      pnl: cur.pnl + (feesAvailable ? t.netPnl : t.pnl),
      count: cur.count + 1,
      brokerNet: false,
    });
  }
  // Override days the broker reported a net for — authoritative after-fees value.
  if (brokerDayNet) {
    for (const [key, net] of Object.entries(brokerDayNet)) {
      const cur = map.get(key);
      // Only override days that actually have trades in the window.
      if (cur && cur.count > 0) {
        map.set(key, { pnl: net, count: cur.count, brokerNet: true });
      }
    }
  }
  return map;
}
