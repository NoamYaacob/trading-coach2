import type { RoundTripTrade } from "./round-trips.ts";

export type TradeStats = {
  /** Sum of round-trip P&L BEFORE fees/commissions. Retained for diagnostics
   *  and the fee reconciliation line — user-facing surfaces headline `netPnl`. */
  grossPnl: number;
  /** Sum of round-trip NET P&L (after fees): Σ netPnl. The user-facing total.
   *  Equals grossPnl when no constituent trade carried broker fee data. */
  netPnl: number;
  /** Total fees/commissions across trades that carried broker fee data. 0 when
   *  no trade reported fees (see feesAvailable to disambiguate from "no fees"). */
  fees: number;
  /** True when at least one trade carried broker fee data, so `netPnl` reflects
   *  fees actually reported. When false, netPnl == grossPnl and the authoritative
   *  net figure is the broker session snapshot (LiveSessionState.dailyPnl). */
  feesAvailable: boolean;
  count: number;
  winners: number;
  losers: number;
  /** 0..1 — null if count is zero. */
  winRate: number | null;
  /** Most positive net pnl across all trades — null if no winners. */
  largestWin: { pnl: number; closedAt: Date } | null;
  /** Most negative net pnl across all trades — null if no losers. */
  largestLoss: { pnl: number; closedAt: Date } | null;
};

export function computeTradeStats(trades: RoundTripTrade[]): TradeStats {
  let grossPnl = 0;
  let netPnl = 0;
  let fees = 0;
  let feesAvailable = false;
  let winners = 0;
  let losers = 0;
  let largestWin: TradeStats["largestWin"] = null;
  let largestLoss: TradeStats["largestLoss"] = null;

  for (const t of trades) {
    grossPnl += t.pnl;
    netPnl += t.netPnl;
    if (t.feesAvailable) {
      feesAvailable = true;
      fees += t.fees ?? 0;
    }
    // Win/loss classification uses the user-facing NET figure.
    if (t.netPnl > 0) {
      winners += 1;
      if (largestWin == null || t.netPnl > largestWin.pnl) {
        largestWin = { pnl: t.netPnl, closedAt: t.closedAt };
      }
    } else if (t.netPnl < 0) {
      losers += 1;
      if (largestLoss == null || t.netPnl < largestLoss.pnl) {
        largestLoss = { pnl: t.netPnl, closedAt: t.closedAt };
      }
    }
  }

  const count = trades.length;
  const winRate = count > 0 ? winners / count : null;

  return { grossPnl, netPnl, fees, feesAvailable, count, winners, losers, winRate, largestWin, largestLoss };
}
