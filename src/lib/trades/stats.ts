import type { RoundTripTrade } from "./round-trips.ts";

export type TradeStats = {
  netPnl: number;
  count: number;
  winners: number;
  losers: number;
  /** 0..1 — null if count is zero. */
  winRate: number | null;
  /** Most positive pnl across all trades — null if no winners. */
  largestWin: { pnl: number; closedAt: Date } | null;
  /** Most negative pnl across all trades — null if no losers. */
  largestLoss: { pnl: number; closedAt: Date } | null;
};

export function computeTradeStats(trades: RoundTripTrade[]): TradeStats {
  let netPnl = 0;
  let winners = 0;
  let losers = 0;
  let largestWin: TradeStats["largestWin"] = null;
  let largestLoss: TradeStats["largestLoss"] = null;

  for (const t of trades) {
    netPnl += t.pnl;
    if (t.pnl > 0) {
      winners += 1;
      if (largestWin == null || t.pnl > largestWin.pnl) {
        largestWin = { pnl: t.pnl, closedAt: t.closedAt };
      }
    } else if (t.pnl < 0) {
      losers += 1;
      if (largestLoss == null || t.pnl < largestLoss.pnl) {
        largestLoss = { pnl: t.pnl, closedAt: t.closedAt };
      }
    }
  }

  const count = trades.length;
  const winRate = count > 0 ? winners / count : null;

  return { netPnl, count, winners, losers, winRate, largestWin, largestLoss };
}
