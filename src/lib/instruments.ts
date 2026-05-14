export type FuturesSpec = {
  kind: "futures";
  symbol: string;
  name: string;
  /** Dollar value of a full one-point price move, per contract. */
  pointValue: number;
  /** Minimum price increment. */
  tickSize: number;
  /** Dollar value of one tick (pointValue * tickSize). */
  tickValue: number;
};

export type StockSpec = { kind: "stock" };
export type CryptoSpec = { kind: "crypto" };
export type ForexSpec = { kind: "forex" };

export type InstrumentSpec = FuturesSpec | StockSpec | CryptoSpec | ForexSpec;

export const FUTURES_SPECS: Record<string, FuturesSpec> = {
  ES:  { kind: "futures", symbol: "ES",  name: "E-mini S&P 500",            pointValue: 50,   tickSize: 0.25, tickValue: 12.50 },
  MES: { kind: "futures", symbol: "MES", name: "Micro E-mini S&P 500",      pointValue: 5,    tickSize: 0.25, tickValue: 1.25  },
  NQ:  { kind: "futures", symbol: "NQ",  name: "E-mini Nasdaq-100",         pointValue: 20,   tickSize: 0.25, tickValue: 5.00  },
  MNQ: { kind: "futures", symbol: "MNQ", name: "Micro E-mini Nasdaq-100",   pointValue: 2,    tickSize: 0.25, tickValue: 0.50  },
  YM:  { kind: "futures", symbol: "YM",  name: "E-mini Dow",                pointValue: 5,    tickSize: 1,    tickValue: 5.00  },
  MYM: { kind: "futures", symbol: "MYM", name: "Micro E-mini Dow",          pointValue: 0.5,  tickSize: 1,    tickValue: 0.50  },
  RTY: { kind: "futures", symbol: "RTY", name: "E-mini Russell 2000",       pointValue: 50,   tickSize: 0.10, tickValue: 5.00  },
  M2K: { kind: "futures", symbol: "M2K", name: "Micro E-mini Russell 2000", pointValue: 5,    tickSize: 0.10, tickValue: 0.50  },
  CL:  { kind: "futures", symbol: "CL",  name: "Crude Oil",                 pointValue: 1000, tickSize: 0.01, tickValue: 10.00 },
  MCL: { kind: "futures", symbol: "MCL", name: "Micro Crude Oil",           pointValue: 100,  tickSize: 0.01, tickValue: 1.00  },
  GC:  { kind: "futures", symbol: "GC",  name: "Gold",                      pointValue: 100,  tickSize: 0.10, tickValue: 10.00 },
  MGC: { kind: "futures", symbol: "MGC", name: "Micro Gold",                pointValue: 10,   tickSize: 0.10, tickValue: 1.00  },
};

export function getInstrumentSpec(symbol: string): InstrumentSpec | null {
  const upper = symbol.trim().toUpperCase();
  return FUTURES_SPECS[upper] ?? null;
}

export function isFuturesSymbol(symbol: string): boolean {
  return symbol.trim().toUpperCase() in FUTURES_SPECS;
}

export function isValidFuturesQuantity(qty: number): boolean {
  return Number.isInteger(qty) && qty > 0;
}

export function isValidTickPrice(price: number, tickSize: number): boolean {
  const rounded = Math.round(price / tickSize) * tickSize;
  return Math.abs(price - rounded) < tickSize * 1e-9;
}

export function calculateFuturesPnl({
  spec,
  direction,
  entryPrice,
  exitPrice,
  quantity,
}: {
  spec: FuturesSpec;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number;
  quantity: number;
}): number {
  const sign = direction === "LONG" ? 1 : -1;
  return (exitPrice - entryPrice) * sign * quantity * spec.pointValue;
}

export function calculateFuturesRisk({
  spec,
  entryPrice,
  stopPrice,
  quantity,
}: {
  spec: FuturesSpec;
  direction?: "LONG" | "SHORT";
  entryPrice: number;
  stopPrice: number;
  quantity: number;
}): number {
  return Math.abs(entryPrice - stopPrice) * quantity * spec.pointValue;
}

export function calculateRMultiple({
  pnl,
  riskAmount,
}: {
  pnl: number;
  riskAmount: number;
}): number | null {
  if (riskAmount <= 0) return null;
  return pnl / riskAmount;
}
