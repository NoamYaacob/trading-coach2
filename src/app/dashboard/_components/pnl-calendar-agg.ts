import type { RoundTripTrade } from "@/lib/trades/round-trips";

export type CalendarDayAgg = { pnl: number; count: number; brokerNet: boolean; fillOnly?: boolean };

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
  const hasBrokerHistory = brokerDayNet != null && Object.keys(brokerDayNet).length > 0;
  const map = new Map<string, CalendarDayAgg>();
  for (const t of trades) {
    const key = t.closedAt.toLocaleDateString("en-CA", { timeZone: timezone });
    const cur = map.get(key) ?? { pnl: 0, count: 0, brokerNet: false };
    map.set(key, {
      pnl: cur.pnl + (feesAvailable ? t.netPnl : t.pnl),
      count: cur.count + 1,
      brokerNet: false,
      // Days from imported fills that have no broker confirmation are flagged
      // as fill-only so broker-native views can exclude or visually separate them.
      fillOnly: hasBrokerHistory && brokerDayNet != null && !(key in brokerDayNet),
    });
  }
  // Override days the broker reported a net for — authoritative after-fees value.
  if (brokerDayNet) {
    for (const [key, net] of Object.entries(brokerDayNet)) {
      const cur = map.get(key);
      if (cur && cur.count > 0) {
        // Day exists in both imported fills and Cash History — use broker net.
        map.set(key, { pnl: net, count: cur.count, brokerNet: true, fillOnly: false });
      } else {
        // Day is in Cash History but not in the fill window — broker data only.
        map.set(key, { pnl: net, count: 0, brokerNet: true, fillOnly: false });
      }
    }
  }
  return map;
}
