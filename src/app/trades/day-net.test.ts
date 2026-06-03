/**
 * Unit tests for day-net.ts pure helpers.
 * No DB, no React — runs with `node --test`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveDayNet, resolveTradeRowNet, type DayTradeRow } from "./day-net.ts";

function r(over: Partial<DayTradeRow>): DayTradeRow {
  return {
    pnl: over.pnl ?? 1.5,
    netPnl: over.netPnl ?? over.pnl ?? 1.5,
    feesAvailable: over.feesAvailable ?? false,
  };
}

describe("resolveDayNet", () => {
  it("the 1868411 case: broker day net -0.40 is authoritative even with fees missing per-trade", () => {
    const rows = [r({ pnl: 1.5, netPnl: 1.5, feesAvailable: false })];
    const out = resolveDayNet(rows, -0.4);
    assert.equal(out.pnl, -0.4, "uses broker net, not fill +1.50");
    assert.equal(out.source, "broker_net");
    assert.equal(out.isNet, true);
  });

  it("falls back to fill P&L before fees when no broker net and fees missing — NOT called net", () => {
    const rows = [r({ pnl: 1.5, netPnl: 1.5, feesAvailable: false })];
    const out = resolveDayNet(rows, undefined);
    assert.equal(out.pnl, 1.5, "shows fill +1.50");
    assert.equal(out.source, "fill_before_fees");
    assert.equal(out.isNet, false, "must NOT be presented as Net");
  });

  it("uses per-trade net when every trade has broker per-fill fees and no broker day net", () => {
    const rows = [
      r({ pnl: 1.5, netPnl: -0.4, feesAvailable: true }),
      r({ pnl: 2.0, netPnl: 1.5, feesAvailable: true }),
    ];
    const out = resolveDayNet(rows, undefined);
    assert.ok(Math.abs(out.pnl - 1.1) < 1e-9, "-0.40 + 1.50 = 1.10");
    assert.equal(out.source, "trade_net");
    assert.equal(out.isNet, true);
  });

  it("broker day net wins even when per-trade fees are also present", () => {
    const rows = [r({ pnl: 1.5, netPnl: -0.4, feesAvailable: true })];
    const out = resolveDayNet(rows, -0.41);
    assert.ok(Math.abs(out.pnl - -0.41) < 1e-9, "broker net is the source of truth");
    assert.equal(out.source, "broker_net");
  });

  it("mixed feesAvailable without broker net → before fees (conservative)", () => {
    const rows = [
      r({ pnl: 1.5, netPnl: -0.4, feesAvailable: true }),
      r({ pnl: 2.0, netPnl: 2.0, feesAvailable: false }),
    ];
    const out = resolveDayNet(rows, undefined);
    assert.equal(out.pnl, 3.5, "sum of fill P&L before fees");
    assert.equal(out.isNet, false);
  });
});

// ---------------------------------------------------------------------------
// resolveTradeRowNet
// ---------------------------------------------------------------------------

describe("resolveTradeRowNet — single-trade day with broker net", () => {
  it("the 1868411 case: tradePnl +1.50, brokerDayNet -0.40 → fees -1.90, net -0.40", () => {
    const res = resolveTradeRowNet(
      { pnl: 1.5, netPnl: 1.5, fees: null, feesAvailable: false },
      1,
      -0.4,
    );
    assert.ok(Math.abs(res.fees! - -1.9) < 1e-9, `fees should be -1.90, got ${res.fees}`);
    assert.ok(Math.abs(res.net! - -0.4) < 1e-9, `net should be -0.40, got ${res.net}`);
  });

  it("positive day: tradePnl +2.00, brokerDayNet +1.50 → fees -0.50, net +1.50", () => {
    const res = resolveTradeRowNet(
      { pnl: 2.0, netPnl: 2.0, fees: null, feesAvailable: false },
      1,
      1.5,
    );
    assert.ok(Math.abs(res.fees! - -0.5) < 1e-9, `fees should be -0.50, got ${res.fees}`);
    assert.ok(Math.abs(res.net! - 1.5) < 1e-9, `net should be +1.50, got ${res.net}`);
  });

  it("zero-fee day: brokerDayNet equals tradePnl → inferred fees = 0", () => {
    const res = resolveTradeRowNet(
      { pnl: 1.5, netPnl: 1.5, fees: null, feesAvailable: false },
      1,
      1.5,
    );
    assert.ok(Math.abs(res.fees! - 0) < 1e-9, "inferred fees should be 0, not hardcoded");
    assert.ok(Math.abs(res.net! - 1.5) < 1e-9);
  });
});

describe("resolveTradeRowNet — multi-trade day without per-trade fees", () => {
  it("returns null/null — cannot allocate day net across multiple trades", () => {
    const res = resolveTradeRowNet(
      { pnl: 1.5, netPnl: 1.5, fees: null, feesAvailable: false },
      2,
      -0.4,
    );
    assert.equal(res.fees, null, "fees must be null for multi-trade day");
    assert.equal(res.net, null, "net must be null for multi-trade day");
  });

  it("no broker net at all also returns null/null", () => {
    const res = resolveTradeRowNet(
      { pnl: 1.5, netPnl: 1.5, fees: null, feesAvailable: false },
      1,
      undefined,
    );
    assert.equal(res.fees, null);
    assert.equal(res.net, null);
  });
});

describe("resolveTradeRowNet — per-trade fees take priority", () => {
  it("per-trade fees win over broker day net on single-trade day", () => {
    const res = resolveTradeRowNet(
      { pnl: 1.5, netPnl: -0.4, fees: 1.9, feesAvailable: true },
      1,
      -0.4,
    );
    assert.ok(Math.abs(res.net! - -0.4) < 1e-9, "net from trade.netPnl");
    assert.ok(Math.abs(res.fees! - -1.9) < 1e-9, "fees negated from trade.fees");
  });

  it("per-trade fees win on multi-trade days too", () => {
    const res = resolveTradeRowNet(
      { pnl: 2.0, netPnl: 1.2, fees: 0.8, feesAvailable: true },
      3,
      undefined,
    );
    assert.ok(Math.abs(res.net! - 1.2) < 1e-9);
    assert.ok(Math.abs(res.fees! - -0.8) < 1e-9);
  });

  it("per-trade feesAvailable with null fees field: null fees but real net", () => {
    const res = resolveTradeRowNet(
      { pnl: 1.5, netPnl: 1.5, fees: null, feesAvailable: true },
      1,
      -0.4,
    );
    assert.equal(res.fees, null);
    assert.ok(Math.abs(res.net! - 1.5) < 1e-9);
  });
});

describe("resolveTradeRowNet — account/day isolation", () => {
  it("only the brokerDayNet passed in is used — no other day's net can leak", () => {
    const resA = resolveTradeRowNet(
      { pnl: 1.5, netPnl: 1.5, fees: null, feesAvailable: false },
      1,
      -0.4,
    );
    const resB = resolveTradeRowNet(
      { pnl: 1.5, netPnl: 1.5, fees: null, feesAvailable: false },
      1,
      99,
    );
    assert.ok(Math.abs(resA.net! - -0.4) < 1e-9, "account A net is -0.40");
    assert.ok(Math.abs(resB.net! - 99) < 1e-9, "account B net is +99 — no cross-contamination");
  });
});
