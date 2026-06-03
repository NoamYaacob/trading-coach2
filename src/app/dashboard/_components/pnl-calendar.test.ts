import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { aggregateCalendarDays } from "./pnl-calendar-agg.ts";
import type { RoundTripTrade } from "@/lib/trades/round-trips";

function trade(over: Partial<RoundTripTrade>): RoundTripTrade {
  return {
    id: over.id ?? "t-1",
    symbol: over.symbol ?? "MNQM6",
    side: over.side ?? "LONG",
    qty: over.qty ?? 1,
    entryPrice: over.entryPrice ?? 100,
    exitPrice: over.exitPrice ?? 105,
    openedAt: over.openedAt ?? new Date("2026-06-01T14:00:00Z"),
    closedAt: over.closedAt ?? new Date("2026-06-01T15:00:00Z"),
    holdMs: over.holdMs ?? 60 * 60 * 1000,
    pnl: over.pnl ?? 1.5,
    pnlSource: over.pnlSource ?? "computed",
    pnlType: over.pnlType ?? "computed",
    fees: over.fees ?? null,
    feesAvailable: over.feesAvailable ?? false,
    netPnl: over.netPnl ?? over.pnl ?? 1.5,
    symbolResolved: over.symbolResolved ?? true,
  };
}

const TZ = "America/Chicago";

describe("aggregateCalendarDays", () => {
  it("sums fill P&L (before fees) when fees unavailable and no broker net", () => {
    const trades = [
      trade({ closedAt: new Date("2026-06-01T15:00:00Z"), pnl: 1.5, netPnl: 1.5, feesAvailable: false }),
    ];
    const map = aggregateCalendarDays(trades, TZ, false);
    const cell = map.get("2026-06-01")!;
    assert.equal(cell.pnl, 1.5);
    assert.equal(cell.count, 1);
    assert.equal(cell.brokerNet, false);
  });

  it("the 1868411 scenario: fillFee empty, but broker day net = -0.40 overrides fill +1.50", () => {
    // Fill P&L is +1.50 and fees are NOT reported per-trade (feesAvailable=false),
    // so the fill aggregation would show +1.50 — which is NOT net. The broker
    // Performance Report supplies the authoritative day net of -0.40.
    const trades = [
      trade({ closedAt: new Date("2026-06-01T15:00:00Z"), pnl: 1.5, netPnl: 1.5, feesAvailable: false }),
    ];
    const map = aggregateCalendarDays(trades, TZ, false, { "2026-06-01": -0.4 });
    const cell = map.get("2026-06-01")!;
    assert.ok(Math.abs(cell.pnl - -0.4) < 1e-9, "broker net -0.40 wins over fill +1.50");
    assert.equal(cell.count, 1, "trade count preserved");
    assert.equal(cell.brokerNet, true);
  });

  it("only overrides days that have trades — phantom broker days are ignored", () => {
    const trades = [
      trade({ closedAt: new Date("2026-06-01T15:00:00Z"), pnl: 1.5, netPnl: 1.5 }),
    ];
    const map = aggregateCalendarDays(trades, TZ, false, {
      "2026-06-01": -0.4,
      "2026-06-02": 99, // no trades that day → must not appear
    });
    assert.ok(map.has("2026-06-01"));
    assert.ok(!map.has("2026-06-02"), "no synthetic cell created for a broker-only day");
  });

  it("falls back to per-trade net for days the broker did not report", () => {
    const trades = [
      trade({ closedAt: new Date("2026-06-01T15:00:00Z"), pnl: 1.5, fees: 1.9, feesAvailable: true, netPnl: -0.4 }),
      trade({ closedAt: new Date("2026-06-02T15:00:00Z"), pnl: 2.0, fees: 0.5, feesAvailable: true, netPnl: 1.5 }),
    ];
    // feesAvailable=true window; broker only reports day 1.
    const map = aggregateCalendarDays(trades, TZ, true, { "2026-06-01": -0.41 });
    assert.ok(Math.abs(map.get("2026-06-01")!.pnl - -0.41) < 1e-9, "day 1 uses broker net");
    assert.equal(map.get("2026-06-01")!.brokerNet, true);
    assert.ok(Math.abs(map.get("2026-06-02")!.pnl - 1.5) < 1e-9, "day 2 uses per-trade net");
    assert.equal(map.get("2026-06-02")!.brokerNet, false);
  });

  it("aggregates multiple trades on the same day before any broker override", () => {
    const trades = [
      trade({ id: "a", closedAt: new Date("2026-06-01T15:00:00Z"), pnl: 1.0, netPnl: 1.0 }),
      trade({ id: "b", closedAt: new Date("2026-06-01T18:00:00Z"), pnl: 2.0, netPnl: 2.0 }),
    ];
    const map = aggregateCalendarDays(trades, TZ, false);
    assert.equal(map.get("2026-06-01")!.pnl, 3.0);
    assert.equal(map.get("2026-06-01")!.count, 2);
  });
});
