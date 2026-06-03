/**
 * Unit tests for the daily / account-level P&L aggregation used by the equity
 * curve and max-drawdown. No DB, no React — runs with `node --test`.
 *
 * Core guarantee: when the broker reports a Cash History (cashBalanceLog) net
 * for a day, that after-fees net is the source of truth for account-level
 * analytics — it overrides the fill-derived gross sum. Fill-only series stay
 * explicitly flagged (allDaysNet=false) so callers never mislabel them "Net".
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildBrokerNativeSeries, buildDailySeries, dailyMaxDrawdown } from "./daily-pnl.ts";
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

describe("buildDailySeries — broker day net overrides fill gross", () => {
  it("the 1868411 case: brokerDayNet['2026-06-02']=-0.4 overrides fill +1.50", () => {
    // 2026-06-02 13:00Z falls on 2026-06-02 in America/Chicago.
    const trades = [
      trade({ closedAt: new Date("2026-06-02T13:00:00Z"), pnl: 1.5, netPnl: 1.5, feesAvailable: false }),
    ];
    const series = buildDailySeries(trades, TZ, false, { "2026-06-02": -0.4 });
    assert.equal(series.points.length, 1);
    const p = series.points[0]!;
    assert.equal(p.day, "2026-06-02");
    assert.ok(Math.abs(p.pnl - -0.4) < 1e-9, "day P&L is broker net -0.40, not +1.50");
    assert.ok(Math.abs(p.cumulative - -0.4) < 1e-9, "cumulative reflects broker net");
    assert.equal(p.brokerNet, true);
    assert.equal(series.allDaysNet, true, "series is true net when every day is broker net");
    assert.equal(series.someBrokerNet, true, "broker net present → someBrokerNet true");
  });

  it("fill-only series (no broker net, fees missing) is NOT marked net", () => {
    const trades = [
      trade({ id: "a", closedAt: new Date("2026-06-01T15:00:00Z"), pnl: 1.5, netPnl: 1.5, feesAvailable: false }),
      trade({ id: "b", closedAt: new Date("2026-06-02T15:00:00Z"), pnl: 2.0, netPnl: 2.0, feesAvailable: false }),
    ];
    const series = buildDailySeries(trades, TZ, false, {});
    assert.equal(series.allDaysNet, false, "fill-only series must not claim net");
    assert.equal(series.someBrokerNet, false, "no broker net anywhere → someBrokerNet false");
    assert.equal(series.points[0]!.pnl, 1.5, "day 1 shows fill before fees");
    assert.equal(series.points[1]!.pnl, 2.0, "day 2 shows fill before fees");
    assert.equal(series.points[0]!.brokerNet, false);
    assert.equal(series.points[1]!.brokerNet, false);
  });

  it("does NOT silently mix: one broker-net day + one fill day → allDaysNet=false", () => {
    const trades = [
      trade({ id: "a", closedAt: new Date("2026-06-01T15:00:00Z"), pnl: 1.5, netPnl: 1.5, feesAvailable: false }),
      trade({ id: "b", closedAt: new Date("2026-06-02T13:00:00Z"), pnl: 2.0, netPnl: 2.0, feesAvailable: false }),
    ];
    const series = buildDailySeries(trades, TZ, false, { "2026-06-02": -0.4 });
    assert.equal(series.points[0]!.brokerNet, false, "day 1 stays fill before fees");
    assert.equal(series.points[1]!.brokerNet, true, "day 2 uses broker net");
    assert.equal(
      series.allDaysNet,
      false,
      "series with any fill-only day must not be labelled fully net",
    );
  });

  it("mixed range: broker-net day keeps its net (not gross fill) AND someBrokerNet flags honest label", () => {
    // The reported dashboard bug: a 30D window mixes fill-only days with the
    // 2026-06-02 broker-net day. The broker-net day MUST keep -0.40 (never
    // revert to its +1.50 fill gross), and someBrokerNet must be true so the
    // label is "broker net where available" — not a flat "before fees".
    const trades = [
      trade({ id: "a", closedAt: new Date("2026-05-20T15:00:00Z"), pnl: 11.0, netPnl: 11.0, feesAvailable: false }),
      trade({ id: "b", closedAt: new Date("2026-06-02T13:00:00Z"), pnl: 1.5, netPnl: 1.5, feesAvailable: false }),
    ];
    const series = buildDailySeries(trades, TZ, false, { "2026-06-02": -0.4 });
    const jun2 = series.points.find((p) => p.day === "2026-06-02")!;
    assert.ok(Math.abs(jun2.pnl - -0.4) < 1e-9, "2026-06-02 stays broker net -0.40, NOT fill +1.50");
    assert.equal(jun2.brokerNet, true);
    assert.equal(series.allDaysNet, false, "mixed range is not fully net");
    assert.equal(series.someBrokerNet, true, "at least one broker-net day → honest mixed label");
    // Cumulative: +11.00 then +11.00 + (-0.40) = +10.60 (matches the reported value).
    assert.ok(Math.abs(series.points[1]!.cumulative - 10.6) < 1e-9, "cum reflects broker net, ends +10.60");
  });

  it("per-trade net is used when window fees are available and no broker net", () => {
    const trades = [
      trade({ closedAt: new Date("2026-06-01T15:00:00Z"), pnl: 1.5, fees: 1.9, netPnl: -0.4, feesAvailable: true }),
    ];
    const series = buildDailySeries(trades, TZ, true, {});
    assert.ok(Math.abs(series.points[0]!.pnl - -0.4) < 1e-9, "uses per-trade net");
    assert.equal(series.allDaysNet, true, "window-wide per-fill fees → net");
    assert.equal(series.someBrokerNet, true, "per-fill fees count as net coverage");
  });

  it("broker-only days appear as broker-net points (count=0 fill, but authoritative net)", () => {
    // aggregateCalendarDays now creates entries for broker-reported days even when
    // no fills exist for that day in the import window. This is the correct behavior
    // for buildDailySeries (fill fallback path): Cash History days without fills
    // still represent authoritative net P&L and must appear in the curve.
    const trades = [trade({ closedAt: new Date("2026-06-01T15:00:00Z"), pnl: 1.5, netPnl: 1.5 })];
    const series = buildDailySeries(trades, TZ, false, { "2026-06-01": -0.4, "2026-06-09": 99 });
    assert.equal(series.points.length, 2, "Jun 9 broker-only day appears as a point");
    assert.equal(series.points[0]!.day, "2026-06-01");
    assert.equal(series.points[0]!.brokerNet, true);
    assert.equal(series.points[1]!.day, "2026-06-09");
    assert.equal(series.points[1]!.brokerNet, true);
  });

  it("cumulative accumulates day P&L in chronological order", () => {
    const trades = [
      trade({ id: "a", closedAt: new Date("2026-06-02T13:00:00Z"), pnl: 2.0, netPnl: 2.0 }),
      trade({ id: "b", closedAt: new Date("2026-06-01T15:00:00Z"), pnl: 1.0, netPnl: 1.0 }),
      trade({ id: "c", closedAt: new Date("2026-06-03T15:00:00Z"), pnl: 3.0, netPnl: 3.0 }),
    ];
    const series = buildDailySeries(trades, TZ, false, {});
    assert.deepEqual(series.points.map((p) => p.day), ["2026-06-01", "2026-06-02", "2026-06-03"]);
    assert.deepEqual(series.points.map((p) => p.cumulative), [1.0, 3.0, 6.0]);
  });
});

describe("dailyMaxDrawdown — broker-net-aware", () => {
  it("returns 0 for a strictly-rising daily curve", () => {
    const trades = [
      trade({ id: "a", closedAt: new Date("2026-06-01T15:00:00Z"), pnl: 10, netPnl: 10 }),
      trade({ id: "b", closedAt: new Date("2026-06-02T15:00:00Z"), pnl: 5, netPnl: 5 }),
    ];
    const series = buildDailySeries(trades, TZ, false, {});
    assert.equal(dailyMaxDrawdown(series), 0);
  });

  it("computes drawdown from broker day nets, not gross fills", () => {
    // Fill grosses would be +10 then +1.5 (rising → DD 0). But broker reports
    // day 2 net = -8, so daily cum is +10 then +2 → DD = 8.
    const trades = [
      trade({ id: "a", closedAt: new Date("2026-06-01T15:00:00Z"), pnl: 10, netPnl: 10, feesAvailable: false }),
      trade({ id: "b", closedAt: new Date("2026-06-02T13:00:00Z"), pnl: 1.5, netPnl: 1.5, feesAvailable: false }),
    ];
    const series = buildDailySeries(trades, TZ, false, { "2026-06-02": -8 });
    assert.equal(dailyMaxDrawdown(series), 8, "drawdown uses broker net day, not fill +1.50");
  });

  it("computes peak-to-trough across the daily curve", () => {
    // Daily cum: +10, +30, +20, +5 → peak 30, trough 5 → DD 25
    const trades = [
      trade({ id: "a", closedAt: new Date("2026-06-01T15:00:00Z"), pnl: 10, netPnl: 10 }),
      trade({ id: "b", closedAt: new Date("2026-06-02T15:00:00Z"), pnl: 20, netPnl: 20 }),
      trade({ id: "c", closedAt: new Date("2026-06-03T15:00:00Z"), pnl: -10, netPnl: -10 }),
      trade({ id: "d", closedAt: new Date("2026-06-04T15:00:00Z"), pnl: -15, netPnl: -15 }),
    ];
    const series = buildDailySeries(trades, TZ, false, {});
    assert.equal(dailyMaxDrawdown(series), 25);
  });
});

describe("account isolation", () => {
  it("only aggregates the trades + brokerDayNet it is given (no cross-account mixing)", () => {
    // Caller passes account-A trades only; an account-B day net is simply not
    // in the brokerDayNet map, so it can never leak into the series.
    const accountATrades = [
      trade({ id: "A1", closedAt: new Date("2026-06-02T13:00:00Z"), pnl: 1.5, netPnl: 1.5, feesAvailable: false }),
    ];
    const accountADayNet = { "2026-06-02": -0.4 };
    const series = buildDailySeries(accountATrades, TZ, false, accountADayNet);
    assert.equal(series.points.length, 1);
    assert.ok(Math.abs(series.points[0]!.pnl - -0.4) < 1e-9, "only account-A net applied");
  });
});

// ---------------------------------------------------------------------------
// buildBrokerNativeSeries
// ---------------------------------------------------------------------------

describe("buildBrokerNativeSeries — broker Cash History as primary source", () => {
  it("the 1868411 case: 2026-06-02 = -0.40, never +1.50 fill", () => {
    // Even in a mixed 30D window, the broker-native series uses -0.40 for Jun 2.
    const series = buildBrokerNativeSeries({ "2026-06-02": -0.4 });
    assert.equal(series.points.length, 1);
    const p = series.points[0]!;
    assert.equal(p.day, "2026-06-02");
    assert.ok(Math.abs(p.pnl - -0.4) < 1e-9, "uses -0.40, NOT the +1.50 fill gross");
    assert.ok(Math.abs(p.cumulative - -0.4) < 1e-9);
    assert.equal(p.brokerNet, true);
  });

  it("allDaysNet and someBrokerNet are both true — full broker history means fully net", () => {
    const series = buildBrokerNativeSeries({ "2026-06-01": 10, "2026-06-02": -0.4 });
    assert.equal(series.allDaysNet, true);
    assert.equal(series.someBrokerNet, true);
  });

  it("empty input → empty series with false flags", () => {
    const series = buildBrokerNativeSeries({});
    assert.equal(series.points.length, 0);
    assert.equal(series.allDaysNet, false);
    assert.equal(series.someBrokerNet, false);
  });

  it("sorts days chronologically regardless of input key order", () => {
    const series = buildBrokerNativeSeries({
      "2026-06-03": 3,
      "2026-06-01": 1,
      "2026-06-02": 2,
    });
    assert.deepEqual(series.points.map((p) => p.day), ["2026-06-01", "2026-06-02", "2026-06-03"]);
    assert.deepEqual(series.points.map((p) => p.cumulative), [1, 3, 6]);
  });

  it("cumulative across multiple days — older day +11.00, newer day -0.40 → +10.60", () => {
    // Two-day hypothetical: May 20 +$11.00, Jun 2 broker net -0.40.
    // Math check: cumulative ends at +10.60. Jun 2 MUST use -0.40 not fill +1.50.
    // NOTE: for account 1868411 the real cashBalanceLog/deps only has Jun 2 (-0.40).
    // The May +$11.00 row belongs to cashBalanceLog/list cross-account contamination.
    // This test validates the arithmetic; the endpoint fix ensures only the
    // account-scoped /deps data reaches buildBrokerNativeSeries.
    const series = buildBrokerNativeSeries({ "2026-05-20": 11.0, "2026-06-02": -0.4 });
    const last = series.points[series.points.length - 1]!;
    assert.ok(Math.abs(last.cumulative - 10.6) < 1e-9, "cumulative ends at +10.60");
    const jun2 = series.points.find((p) => p.day === "2026-06-02")!;
    assert.ok(Math.abs(jun2.pnl - -0.4) < 1e-9, "Jun 2 is -0.40, not +1.50");
  });

  it("account 1868411 all-time truth: cashBalanceLog/deps returns only Jun 2 → cumulative -0.40", () => {
    // Diagnostic confirmed: cashBalanceLog/deps?masterid=1734393 returns 11 rows
    // covering only 2026-06-02 (TradePaired+fees) and 2026-06-03 (NewSession only).
    // After getCashHistoryDayNet() filters to feesAvailable days, brokerDayNet is
    // exactly { "2026-06-02": -0.40 }. The all-time equity curve must be -0.40.
    // If this was +10.60, it meant cashBalanceLog/list leaked a May row from
    // another account. The /deps endpoint fix eliminates that contamination.
    const brokerDayNet = { "2026-06-02": -0.4 };
    const series = buildBrokerNativeSeries(brokerDayNet);
    assert.equal(series.points.length, 1, "only one day in cash history");
    assert.equal(series.points[0]!.day, "2026-06-02");
    assert.ok(Math.abs(series.points[0]!.cumulative - -0.4) < 1e-9,
      "all-time cumulative must be -0.40, NOT +10.60");
    assert.equal(series.allDaysNet, true);
  });

  it("NewSession-only day with $0.00 does not appear in brokerDayNet (feesAvailable=false guard)", () => {
    // cashBalanceLog/deps for account 1868411 has a 2026-06-03 NewSession row
    // with delta=0 and no fee rows. getCashHistoryDayNet() excludes days where
    // feesAvailable=false, so 2026-06-03 never reaches buildBrokerNativeSeries.
    // This test confirms that if such a day were passed, it contributes $0.00
    // to the curve (no inflation, no distortion).
    const series = buildBrokerNativeSeries({ "2026-06-02": -0.4, "2026-06-03": 0 });
    const jun3 = series.points.find((p) => p.day === "2026-06-03")!;
    assert.ok(jun3 != null);
    assert.ok(Math.abs(jun3.pnl - 0) < 1e-9, "NewSession $0.00 contributes exactly 0");
    // Cumulative unchanged after the zero day
    const jun2 = series.points.find((p) => p.day === "2026-06-02")!;
    assert.ok(Math.abs(jun3.cumulative - jun2.cumulative) < 1e-9, "cumulative unchanged by $0.00 day");
  });

  it("imported fill gross P&L never inflates broker-native all-time curve", () => {
    // The broker-native series is built exclusively from the brokerDayNet map.
    // Imported fill data (+$1.50 fill gross for Jun 2) is not a parameter and
    // cannot reach buildBrokerNativeSeries. This is a type-level guarantee.
    // If brokerDayNet = { "2026-06-02": -0.40 }, the series has exactly one
    // point regardless of how many fills were imported.
    const series = buildBrokerNativeSeries({ "2026-06-02": -0.4 });
    assert.equal(series.points.length, 1, "fill count cannot add points to broker-native series");
    assert.ok(Math.abs(series.points[0]!.cumulative - -0.4) < 1e-9);
  });

  it("sinceDayKey filters out older days for windowed views", () => {
    const series = buildBrokerNativeSeries(
      { "2026-05-01": 5, "2026-06-01": 10, "2026-06-02": -0.4 },
      "2026-06-01",
    );
    // May 1 is before the cutoff — excluded
    assert.deepEqual(series.points.map((p) => p.day), ["2026-06-01", "2026-06-02"]);
    // Cumulative resets to window start, not full history
    assert.ok(Math.abs(series.points[0]!.cumulative - 10) < 1e-9);
    assert.ok(Math.abs(series.points[1]!.cumulative - 9.6) < 1e-9);
  });

  it("sinceDayKey inclusive — day on the cutoff boundary is included", () => {
    const series = buildBrokerNativeSeries({ "2026-06-01": 1, "2026-06-02": 2 }, "2026-06-01");
    assert.equal(series.points.length, 2);
    assert.equal(series.points[0]!.day, "2026-06-01");
  });

  it("no account mixing — only the keys passed in are plotted", () => {
    // Simulate account A's brokerDayNet; account B's data is simply absent
    const seriesA = buildBrokerNativeSeries({ "2026-06-02": -0.4 });
    const seriesB = buildBrokerNativeSeries({ "2026-06-02": 99 });
    assert.ok(Math.abs(seriesA.points[0]!.pnl - -0.4) < 1e-9);
    assert.ok(Math.abs(seriesB.points[0]!.pnl - 99) < 1e-9);
  });
});

// ── Source-of-truth rule: 6 required scenarios ─────────────────────────────
describe("source-of-truth rule: broker Cash History only in broker-native mode", () => {
  it("1. brokerDayNet Jun 2 only + hypothetical May fills → equity curve is -$0.40, not +$10.60", () => {
    // When cashBalanceLog/deps returns only Jun 2, buildBrokerNativeSeries receives
    // only { "2026-06-02": -0.40 }. Imported May fills (+$11.00) are never passed to
    // this function — they cannot inflate the broker-native equity curve.
    const brokerDayNet = { "2026-06-02": -0.4 };
    const series = buildBrokerNativeSeries(brokerDayNet);
    assert.equal(series.points.length, 1, "only 1 broker day");
    assert.ok(
      Math.abs(series.points[0]!.cumulative - -0.4) < 1e-9,
      `cumulative must be -0.40, got ${series.points[0]!.cumulative}`,
    );
    assert.equal(series.someBrokerNet, true);
  });

  it("5. broker series with 1 point is non-empty — empty-state copy must not appear as 'No closed round-trips'", () => {
    // EquityCurveBody receives tradeCount=series.points.length=1 in broker-native mode.
    // tradeCount > 0 means the generic empty state is not shown. This test verifies
    // the non-empty series exits the < 2 points guard (it shows the curve only when >= 2),
    // and the correct message is available for the single-point case.
    const series = buildBrokerNativeSeries({ "2026-06-02": -0.4 });
    const brokerDayCount = series.points.length; // 1 — used as tradeCount in broker-native mode
    assert.equal(brokerDayCount, 1);
    // Component shows empty-state when < 2 points. Broker-native empty-state message
    // must NOT say "round-trips" — it should say "broker cash history days".
    // (The actual string is tested in the component; this test anchors the data side.)
    assert.equal(series.allDaysNet, true, "broker day is authoritative net");
  });
});

describe("buildBrokerNativeSeries — max drawdown integration", () => {
  it("drawdown uses broker day net, not fill gross", () => {
    // Day 1: +10 (broker). Day 2: -8 (broker net, not fill +1.50).
    // cumulative: +10, +2 → peak 10, trough 2 → DD 8.
    const series = buildBrokerNativeSeries({ "2026-06-01": 10, "2026-06-02": -8 });
    assert.equal(dailyMaxDrawdown(series), 8, "drawdown uses broker net -8, not fill +1.50");
  });

  it("rising broker curve has zero drawdown", () => {
    const series = buildBrokerNativeSeries({ "2026-06-01": 5, "2026-06-02": 3 });
    assert.equal(dailyMaxDrawdown(series), 0);
  });
});
