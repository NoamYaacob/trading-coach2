export type TradeEntry = {
  id: string;
  symbol: string;
  direction: string;
  tradedAt: string; // ISO UTC string
  entryPrice: number | null;
  exitPrice: number | null;
  stopPrice: number | null;
  targetPrice: number | null;
  quantity: number | null;
  pnl: number | null;
  fees: number | null;
  grossPnl: number | null;
  pnlSource: string | null;
  riskAmount: number | null;
  rMultiple: number | null;
  strategy: string | null;
  notes: string | null;
  ruleBreached: boolean;
  breachReason: string | null;
};
