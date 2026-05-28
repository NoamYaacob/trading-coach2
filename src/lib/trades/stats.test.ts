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
  };
}

describe("computeTradeStats", () => {
  it("returns zeros for empty input", () => {
    const s = computeTradeStats([]);
    assert.equal(s.netPnl, 0);
    assert.equal(s.count, 0);
    assert.equal(s.winners, 0);
    assert.equal(s.losers, 0);
    assert.equal(s.winRate, null);
    assert.equal(s.largestWin, null);
    assert.equal(s.largestLoss, null);
  });

  it("sums net P&L correctly", () => {
    const s = computeTradeStats([trade({ pnl: 10 }), trade({ pnl: -3 }), trade({ pnl: 7 })]);
    assert.equal(s.netPnl, 14);
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
