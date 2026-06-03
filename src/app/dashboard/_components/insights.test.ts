/**
 * Unit tests for the pure trader-insight helpers.
 * No DB, no React, no I/O — runs with `node --test`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  biggestLoss,
  biggestWin,
  expectancy,
  maxDrawdown,
  pnlByDayOfWeek,
  pnlByHourOfDay,
  profitFactor,
} from "./insights.ts";
import type { RoundTripTrade } from "@/lib/trades/round-trips";

function trade(over: Partial<RoundTripTrade> & { pnl: number; closedAt: Date }): RoundTripTrade {
  return {
    id: over.id ?? `t-${Math.random()}`,
    symbol: over.symbol ?? "ESH5",
    side: over.side ?? "LONG",
    qty: over.qty ?? 1,
    entryPrice: over.entryPrice ?? 100,
    exitPrice: over.exitPrice ?? 101,
    openedAt: over.openedAt ?? over.closedAt,
    closedAt: over.closedAt,
    holdMs: over.holdMs ?? 0,
    pnl: over.pnl,
    pnlSource: over.pnlSource ?? "computed",
    pnlType: over.pnlType ?? "computed",
    fees: over.fees ?? null,
    feesAvailable: over.feesAvailable ?? false,
    netPnl: over.netPnl ?? over.pnl,
    symbolResolved: over.symbolResolved ?? true,
  };
}

describe("maxDrawdown", () => {
  it("returns 0 on empty input", () => {
    assert.equal(maxDrawdown([]), 0);
  });

  it("returns 0 on a strictly winning sequence", () => {
    const trades = [
      trade({ pnl: 10, closedAt: new Date("2026-01-01T14:00:00Z") }),
      trade({ pnl: 5, closedAt: new Date("2026-01-01T15:00:00Z") }),
      trade({ pnl: 20, closedAt: new Date("2026-01-01T16:00:00Z") }),
    ];
    assert.equal(maxDrawdown(trades), 0);
  });

  it("computes drawdown for a peak-then-fall sequence", () => {
    // Cum: +10, +30, +20, +5  → peak 30, lowest 5 → DD = 25
    const trades = [
      trade({ pnl: 10, closedAt: new Date("2026-01-01T14:00:00Z") }),
      trade({ pnl: 20, closedAt: new Date("2026-01-01T15:00:00Z") }),
      trade({ pnl: -10, closedAt: new Date("2026-01-01T16:00:00Z") }),
      trade({ pnl: -15, closedAt: new Date("2026-01-01T17:00:00Z") }),
    ];
    assert.equal(maxDrawdown(trades), 25);
  });

  it("uses the worst drawdown across multiple peaks", () => {
    // Cum: +10, -5(drop15 from peak10), +15(new peak20), -10(drop30 from 20)
    const trades = [
      trade({ pnl: 10, closedAt: new Date("2026-01-01T14:00:00Z") }),
      trade({ pnl: -15, closedAt: new Date("2026-01-01T15:00:00Z") }),
      trade({ pnl: 25, closedAt: new Date("2026-01-01T16:00:00Z") }),
      trade({ pnl: -30, closedAt: new Date("2026-01-01T17:00:00Z") }),
    ];
    assert.equal(maxDrawdown(trades), 30);
  });

  it("sorts chronologically before computing drawdown", () => {
    // Passed out of order but should produce same result.
    const trades = [
      trade({ pnl: -15, closedAt: new Date("2026-01-01T17:00:00Z") }),
      trade({ pnl: 10, closedAt: new Date("2026-01-01T14:00:00Z") }),
      trade({ pnl: 20, closedAt: new Date("2026-01-01T15:00:00Z") }),
      trade({ pnl: -10, closedAt: new Date("2026-01-01T16:00:00Z") }),
    ];
    // Chronological cum: +10, +30, +20, +5 → DD 25
    assert.equal(maxDrawdown(trades), 25);
  });
});

describe("profitFactor", () => {
  it("returns null on empty input", () => {
    assert.equal(profitFactor([]), null);
  });

  it("returns null when there are wins but no losses", () => {
    const trades = [
      trade({ pnl: 10, closedAt: new Date("2026-01-01T14:00:00Z") }),
      trade({ pnl: 5, closedAt: new Date("2026-01-01T15:00:00Z") }),
    ];
    assert.equal(profitFactor(trades), null);
  });

  it("returns null when there are no losses and no wins", () => {
    const trades = [
      trade({ pnl: 0, closedAt: new Date("2026-01-01T14:00:00Z") }),
    ];
    assert.equal(profitFactor(trades), null);
  });

  it("computes gross wins / gross losses for mixed trades", () => {
    // wins=30, losses=10 → 3
    const trades = [
      trade({ pnl: 20, closedAt: new Date("2026-01-01T14:00:00Z") }),
      trade({ pnl: 10, closedAt: new Date("2026-01-01T15:00:00Z") }),
      trade({ pnl: -10, closedAt: new Date("2026-01-01T16:00:00Z") }),
    ];
    assert.equal(profitFactor(trades), 3);
  });
});

describe("expectancy", () => {
  it("returns null on empty input", () => {
    assert.equal(expectancy([]), null);
  });

  it("returns the lone trade's pnl when given one trade", () => {
    const trades = [
      trade({ pnl: 12.5, closedAt: new Date("2026-01-01T14:00:00Z") }),
    ];
    assert.equal(expectancy(trades), 12.5);
  });

  it("returns the average pnl across mixed trades", () => {
    const trades = [
      trade({ pnl: 10, closedAt: new Date("2026-01-01T14:00:00Z") }),
      trade({ pnl: -4, closedAt: new Date("2026-01-01T15:00:00Z") }),
    ];
    assert.equal(expectancy(trades), 3);
  });
});

describe("pnlByDayOfWeek", () => {
  it("returns 7 zero buckets on empty input", () => {
    const buckets = pnlByDayOfWeek([], "UTC");
    assert.equal(buckets.length, 7);
    assert.deepEqual(
      buckets.map((b) => b.label),
      ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    );
    for (const b of buckets) {
      assert.equal(b.pnl, 0);
      assert.equal(b.count, 0);
    }
  });

  it("aggregates trades by weekday in the supplied timezone", () => {
    // 2026-01-05 UTC is a Monday.
    const trades = [
      trade({ pnl: 10, closedAt: new Date("2026-01-05T12:00:00Z") }),
      trade({ pnl: 5, closedAt: new Date("2026-01-05T15:00:00Z") }),
    ];
    const buckets = pnlByDayOfWeek(trades, "UTC");
    const mon = buckets.find((b) => b.label === "Mon")!;
    assert.equal(mon.pnl, 15);
    assert.equal(mon.count, 2);
    const tue = buckets.find((b) => b.label === "Tue")!;
    assert.equal(tue.count, 0);
  });
});

describe("pnlByHourOfDay", () => {
  it("returns 24 zero buckets on empty input", () => {
    const buckets = pnlByHourOfDay([], "UTC");
    assert.equal(buckets.length, 24);
    for (let h = 0; h < 24; h++) {
      assert.equal(buckets[h]!.hour, h);
      assert.equal(buckets[h]!.pnl, 0);
      assert.equal(buckets[h]!.count, 0);
    }
  });

  it("aggregates trades into the right hour bucket", () => {
    const trades = [
      trade({ pnl: 10, closedAt: new Date("2026-01-05T13:00:00Z") }),
      trade({ pnl: 5, closedAt: new Date("2026-01-05T13:30:00Z") }),
      trade({ pnl: -3, closedAt: new Date("2026-01-05T14:15:00Z") }),
    ];
    const buckets = pnlByHourOfDay(trades, "UTC");
    assert.equal(buckets[13]!.pnl, 15);
    assert.equal(buckets[13]!.count, 2);
    assert.equal(buckets[14]!.pnl, -3);
    assert.equal(buckets[14]!.count, 1);
  });
});

describe("biggestWin", () => {
  it("returns null on empty input", () => {
    assert.equal(biggestWin([]), null);
  });

  it("returns null when no trade has positive pnl", () => {
    const trades = [
      trade({ pnl: -10, closedAt: new Date("2026-01-01T14:00:00Z") }),
      trade({ pnl: 0, closedAt: new Date("2026-01-01T15:00:00Z") }),
    ];
    assert.equal(biggestWin(trades), null);
  });

  it("returns the trade with the largest positive pnl", () => {
    const trades = [
      trade({ id: "a", pnl: 10, closedAt: new Date("2026-01-01T14:00:00Z") }),
      trade({ id: "b", pnl: 25, closedAt: new Date("2026-01-01T15:00:00Z") }),
      trade({ id: "c", pnl: -50, closedAt: new Date("2026-01-01T16:00:00Z") }),
    ];
    assert.equal(biggestWin(trades)?.id, "b");
  });
});

describe("biggestLoss", () => {
  it("returns null on empty input", () => {
    assert.equal(biggestLoss([]), null);
  });

  it("returns null when no trade has negative pnl", () => {
    const trades = [
      trade({ pnl: 10, closedAt: new Date("2026-01-01T14:00:00Z") }),
    ];
    assert.equal(biggestLoss(trades), null);
  });

  it("returns the trade with the largest negative pnl", () => {
    const trades = [
      trade({ id: "a", pnl: -10, closedAt: new Date("2026-01-01T14:00:00Z") }),
      trade({ id: "b", pnl: -25, closedAt: new Date("2026-01-01T15:00:00Z") }),
      trade({ id: "c", pnl: 50, closedAt: new Date("2026-01-01T16:00:00Z") }),
    ];
    assert.equal(biggestLoss(trades)?.id, "b");
  });
});

// ---------------------------------------------------------------------------
// Source-scan contract: equity-curve & max-drawdown labels are honest about
// the P&L basis actually used (broker net / mixed / fill before fees).
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readComponent(rel: string): string {
  return readFileSync(resolve(process.cwd(), "src/app/dashboard/_components", rel), "utf8");
}

describe("equity-curve — broker-native primary path", () => {
  const src = readComponent("equity-curve.tsx");

  it("uses buildBrokerNativeSeries as the primary path when broker history exists", () => {
    assert.ok(src.includes("buildBrokerNativeSeries"), "must import and call buildBrokerNativeSeries");
    assert.ok(src.includes("hasBrokerHistory"), "must gate the broker-native path on hasBrokerHistory");
  });

  it("broker history detected via non-empty brokerDayNet", () => {
    assert.ok(
      src.includes("Object.keys(brokerDayNet).length > 0"),
      "hasBrokerHistory must check Object.keys(brokerDayNet).length > 0",
    );
  });

  it("windowed views filter by sinceDayKey (day-key comparison, not by trade date)", () => {
    assert.ok(src.includes("sinceDayKey"), "broker-native path must use a sinceDayKey cutoff for 7D/14D/30D");
  });

  it("uses allDaysNet for the fully-net label (broker-native is always allDaysNet)", () => {
    assert.ok(src.includes("series.allDaysNet"), "must branch on series.allDaysNet");
    assert.ok(src.includes("Net · after broker fees"), "fully-net curve must be labelled 'Net · after broker fees'");
  });

  it("mixed fill-fallback ranges use someBrokerNet — broker-net days not relabelled as flat fill", () => {
    assert.ok(src.includes("series.someBrokerNet"), "must branch on series.someBrokerNet for mixed ranges");
    assert.ok(src.includes("Broker net where available"), "mixed range must say 'Broker net where available'");
  });

  it("all-time view with broker history shows source label + coverage start, not 'imported history only'", () => {
    assert.ok(
      src.includes("Net realized P&L") && src.includes("${sourceLabel} from ${coverageStartLabel}"),
      "all-time broker-native view must say 'Net realized P&L · <source> from <date>' — not 'imported history only'",
    );
  });

  it("all-time fill-fallback view says 'partial imported fills only'", () => {
    assert.ok(
      src.includes("partial imported fills only"),
      "fill-fallback all-time view must say 'partial imported fills only' — not the old 'imported history only'",
    );
  });
});

describe("max-drawdown — broker-native primary path", () => {
  const src = readComponent("trader-insights.tsx");

  it("uses buildBrokerNativeSeries when broker history is available", () => {
    assert.ok(src.includes("buildBrokerNativeSeries"), "must call buildBrokerNativeSeries");
    assert.ok(src.includes("hasBrokerHistory"), "must gate on hasBrokerHistory");
  });

  it("drawdown is computed from the daily series (broker-native or fill-based)", () => {
    assert.ok(src.includes("dailyMaxDrawdown(dailySeries)"), "drawdown must use dailyMaxDrawdown");
  });

  it("fully-net drawdown (allDaysNet) is labelled 'after broker fees'", () => {
    assert.ok(src.includes("cum. daily net P&L · after broker fees"), "fully-net label must say 'after broker fees'");
  });

  it("mixed drawdown uses someBrokerNet — not a flat 'before fees'", () => {
    assert.ok(src.includes("dailySeries.someBrokerNet"), "must branch on someBrokerNet");
    assert.ok(src.includes("broker net where available"), "mixed drawdown must say 'broker net where available'");
  });

  it("fill-only drawdown is labelled 'before fees'", () => {
    assert.ok(src.includes("cum. daily fill P&L · before fees"), "fill-only keeps the honest 'before fees' label");
  });

  it("stale copy removed — no longer says 'broker fills only'", () => {
    assert.ok(
      !src.includes("broker fills only"),
      "stale 'broker fills only' copy must be removed",
    );
  });
});

describe("pnl-calendar — HTML entities in JS strings are literal", () => {
  const src = readComponent("pnl-calendar.tsx");

  it("subtitle uses plain & in JS string, not &amp; which renders literally", () => {
    assert.ok(
      !src.includes('"Net P&amp;L"') && !src.includes('"Fill P&amp;L'),
      "subtitle JS strings must not use &amp; — use plain & so React renders Net P&L not Net P&amp;L",
    );
    assert.ok(src.includes('"Net P&L"') || src.includes("'Net P&L'"), "subtitle must contain plain Net P&L string");
  });
});
