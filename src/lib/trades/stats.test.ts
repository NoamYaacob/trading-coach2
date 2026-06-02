import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { computeTradeStats } from "./stats.ts";
import type { RoundTripTrade } from "./round-trips.ts";

function trade(over: Partial<RoundTripTrade>): RoundTripTrade {
  return {
    id: over.id ?? "t-1",
    symbol: over.symbol ?? "ESH5",
    side: over.side ?? "LONG",
    qty: over.qty ?? 1,
    entryPrice: over.entryPrice ?? 100,
    exitPrice: over.exitPrice ?? 105,
    openedAt: over.openedAt ?? new Date("2026-01-01T14:00:00Z"),
    closedAt: over.closedAt ?? new Date("2026-01-01T14:30:00Z"),
    holdMs: over.holdMs ?? 30 * 60 * 1000,
    pnl: over.pnl ?? 5,
    pnlSource: over.pnlSource ?? "computed",
    pnlType: over.pnlType ?? "computed",
    fees: over.fees ?? null,
    feesAvailable: over.feesAvailable ?? false,
    netPnl: over.netPnl ?? over.pnl ?? 5,
    symbolResolved: over.symbolResolved ?? true,
  };
}

describe("computeTradeStats", () => {
  it("returns zeros for empty input", () => {
    const s = computeTradeStats([]);
    assert.equal(s.grossPnl, 0);
    assert.equal(s.count, 0);
    assert.equal(s.winners, 0);
    assert.equal(s.losers, 0);
    assert.equal(s.winRate, null);
    assert.equal(s.largestWin, null);
    assert.equal(s.largestLoss, null);
  });

  it("sums net P&L correctly", () => {
    const s = computeTradeStats([trade({ pnl: 10 }), trade({ pnl: -3 }), trade({ pnl: 7 })]);
    assert.equal(s.grossPnl, 14);
  });

  it("counts winners and losers, breaks-even excluded from both", () => {
    const s = computeTradeStats([
      trade({ pnl: 5 }),
      trade({ pnl: -2 }),
      trade({ pnl: 0 }),
      trade({ pnl: 3 }),
    ]);
    assert.equal(s.winners, 2);
    assert.equal(s.losers, 1);
    assert.equal(s.count, 4);
  });

  it("computes win rate as winners / count", () => {
    const s = computeTradeStats([trade({ pnl: 5 }), trade({ pnl: 5 }), trade({ pnl: -10 })]);
    assert.equal(s.winRate, 2 / 3);
  });

  it("finds largest win and largest loss with their dates", () => {
    const d1 = new Date("2026-01-01T14:00:00Z");
    const d2 = new Date("2026-01-02T14:00:00Z");
    const s = computeTradeStats([
      trade({ pnl: 5, closedAt: d1 }),
      trade({ pnl: 12, closedAt: d2 }),
      trade({ pnl: -3 }),
      trade({ pnl: -8, closedAt: d2 }),
    ]);
    assert.equal(s.largestWin?.pnl, 12);
    assert.equal(s.largestWin?.closedAt.getTime(), d2.getTime());
    assert.equal(s.largestLoss?.pnl, -8);
    assert.equal(s.largestLoss?.closedAt.getTime(), d2.getTime());
  });

  it("largest win is null when no winners", () => {
    const s = computeTradeStats([trade({ pnl: -1 }), trade({ pnl: -2 })]);
    assert.equal(s.largestWin, null);
    assert.equal(s.largestLoss?.pnl, -2);
  });
});

describe("computeTradeStats — net vs before-fees (the 1868411 scenario)", () => {
  it("fees missing: feesAvailable=false, fees=0, netPnl falls back to gross (+1.50)", () => {
    // gross/fill P&L = +1.50, no broker fee data → the UI must NOT call this Net.
    const s = computeTradeStats([
      trade({ pnl: 1.5, netPnl: 1.5, fees: null, feesAvailable: false }),
    ]);
    assert.equal(s.grossPnl, 1.5, "gross (fill) P&L is +1.50");
    assert.equal(s.feesAvailable, false, "feesAvailable must be false so UI shows 'before fees', not Net");
    assert.equal(s.fees, 0, "no fees to total");
    assert.equal(s.netPnl, 1.5, "netPnl numerically falls back to gross — but feesAvailable=false flags it as not truly net");
  });

  it("fees present (1.90): feesAvailable=true, netPnl=-0.40 — UI can label it Net", () => {
    const s = computeTradeStats([
      trade({ pnl: 1.5, fees: 1.9, feesAvailable: true, netPnl: 1.5 - 1.9 }),
    ]);
    assert.equal(s.grossPnl, 1.5);
    assert.equal(s.fees, 1.9);
    assert.equal(s.feesAvailable, true);
    assert.ok(Math.abs(s.netPnl - -0.4) < 1e-9, "net = 1.50 - 1.90 = -0.40");
  });

  it("mixed: feesAvailable is true if ANY trade has fees; fees totals only fee-bearing trades", () => {
    const s = computeTradeStats([
      trade({ pnl: 1.5, fees: 1.9, feesAvailable: true, netPnl: -0.4 }),
      trade({ pnl: 2.0, fees: null, feesAvailable: false, netPnl: 2.0 }),
    ]);
    assert.equal(s.feesAvailable, true);
    assert.equal(s.fees, 1.9, "only the fee-bearing trade contributes to the fee total");
  });
});
