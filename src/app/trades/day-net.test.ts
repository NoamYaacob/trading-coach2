/**
 * Unit tests for day-net.ts pure helpers.
 * No DB, no React — runs with `node --test`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  resolveDayNet,
  resolveTradeRowNet,
  resolveTradeClassification,
  resolveDayRowNets,
  type DayTradeRow,
  type DayRowInput,
} from "./day-net.ts";

function dr(over: Partial<DayRowInput> & { id: string }): DayRowInput {
  return {
    id: over.id,
    pnl: over.pnl ?? 0,
    netPnl: over.netPnl ?? over.pnl ?? 0,
    fees: over.fees ?? null,
    feesAvailable: over.feesAvailable ?? false,
    qty: over.qty ?? 1,
  };
}

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

// ---------------------------------------------------------------------------
// resolveTradeClassification
// ---------------------------------------------------------------------------

describe("resolveTradeClassification — net-based winning/losing", () => {
  it("the 1868411 case: gross +1.50, broker net -0.40 → losing (not winning)", () => {
    const cls = resolveTradeClassification(
      { pnl: 1.5, netPnl: 1.5, fees: null, feesAvailable: false },
      1,
      -0.4,
    );
    assert.equal(cls, "losing", "gross positive but net negative must be losing");
  });

  it("winning filter must exclude the gross-positive / net-negative trade", () => {
    const trade = { pnl: 1.5, netPnl: 1.5, fees: null, feesAvailable: false };
    const cls = resolveTradeClassification(trade, 1, -0.4);
    assert.ok(cls !== "winning", "winning filter must not include this trade");
  });

  it("losing filter must include the gross-positive / net-negative trade", () => {
    const trade = { pnl: 1.5, netPnl: 1.5, fees: null, feesAvailable: false };
    const cls = resolveTradeClassification(trade, 1, -0.4);
    assert.equal(cls, "losing", "losing filter must include net-negative trade");
  });

  it("positive gross and positive net → winning", () => {
    const cls = resolveTradeClassification(
      { pnl: 2.0, netPnl: 2.0, fees: null, feesAvailable: false },
      1,
      1.5,
    );
    assert.equal(cls, "winning");
  });

  it("negative gross, no broker net → losing (fallback to gross)", () => {
    const cls = resolveTradeClassification(
      { pnl: -1.0, netPnl: -1.0, fees: null, feesAvailable: false },
      1,
      undefined,
    );
    assert.equal(cls, "losing");
  });

  it("multi-trade day without broker net or per-trade fees → falls back to gross pnl", () => {
    const cls = resolveTradeClassification(
      { pnl: 1.5, netPnl: 1.5, fees: null, feesAvailable: false },
      3,
      -0.4,
    );
    // resolveTradeRowNet returns null net for multi-trade day without per-fill fees
    // so classification falls back to gross +1.50 → winning
    assert.equal(cls, "winning", "multi-trade day without per-fill fees falls back to gross");
  });

  it("zero effective net → flat", () => {
    const cls = resolveTradeClassification(
      { pnl: 1.0, netPnl: 1.0, fees: null, feesAvailable: false },
      1,
      0,
    );
    assert.equal(cls, "flat");
  });
});

// ---------------------------------------------------------------------------
// resolveDayRowNets — two-tier fee model
// ---------------------------------------------------------------------------

describe("resolveDayRowNets — Tier A exact (cashBalanceLog/deps fillId fees)", () => {
  it("Jun 2: single trade with exact per-fill fees keeps exact fees/net", () => {
    const out = resolveDayRowNets(
      [dr({ id: "jun2", pnl: 1.5, netPnl: -0.4, fees: 1.9, feesAvailable: true, qty: 2 })],
      -0.4,
    );
    const r = out.get("jun2")!;
    assert.equal(r.feeSource, "exact");
    assert.ok(Math.abs(r.fees! - -1.9) < 1e-9, `fees -1.90, got ${r.fees}`);
    assert.ok(Math.abs(r.net! - -0.4) < 1e-9, `net -0.40, got ${r.net}`);
  });

  it("exact fees win even when an ABH day net is also present", () => {
    const out = resolveDayRowNets(
      [dr({ id: "a", pnl: 2.0, netPnl: 1.2, fees: 0.8, feesAvailable: true, qty: 1 })],
      99, // ABH net deliberately wrong — exact must still win
    );
    assert.equal(out.get("a")!.net, 1.2);
    assert.equal(out.get("a")!.feeSource, "exact");
  });
});

describe("resolveDayRowNets — Tier B Account-Balance-derived (Apr 30 historical)", () => {
  it("single historical trade: derives fees = ABHnet - gross, net = ABHnet", () => {
    const out = resolveDayRowNets(
      [dr({ id: "h1", pnl: -210.2, netPnl: -210.2, feesAvailable: false, qty: 4 })],
      -212.1, // ABH day net for Apr 30
    );
    const r = out.get("h1")!;
    assert.equal(r.feeSource, "account-balance-derived");
    assert.ok(Math.abs(r.fees! - -1.9) < 1e-9, `derived fees -1.90, got ${r.fees}`);
    assert.ok(Math.abs(r.net! - -212.1) < 1e-9, `net -212.10, got ${r.net}`);
  });

  it("multi-trade historical day: allocates day fees by qty and reconciles to ABH net", () => {
    // Two historical trades, gross sums to -200; ABH day net -212.10 → total
    // derived fees -12.10, split by qty (3:1).
    const rows = [
      dr({ id: "t1", pnl: -150, feesAvailable: false, qty: 3 }),
      dr({ id: "t2", pnl: -50, feesAvailable: false, qty: 1 }),
    ];
    const out = resolveDayRowNets(rows, -212.1);
    const r1 = out.get("t1")!;
    const r2 = out.get("t2")!;
    assert.equal(r1.feeSource, "account-balance-derived");
    assert.equal(r2.feeSource, "account-balance-derived");
    // qty weights: t1 = 3/4 of -12.10 = -9.075 → -9.07 (round-half-up); t2 = remainder.
    assert.ok(Math.abs(r1.fees! - -9.07) < 1e-9, `t1 fee ~-9.07, got ${r1.fees}`);
    // RECONCILIATION: sum of nets == ABH day net (exactly).
    const sumNet = r1.net! + r2.net!;
    assert.ok(Math.abs(sumNet - -212.1) < 1e-9, `sum of nets must equal ABH -212.10, got ${sumNet}`);
    // Sum of derived fees == total derived fees (no rounding drift lost).
    const sumFees = r1.fees! + r2.fees!;
    assert.ok(Math.abs(sumFees - -12.1) < 1e-9, `sum of fees must equal -12.10, got ${sumFees}`);
  });

  it("reconciliation holds for a 3-trade day with uneven quantities", () => {
    const rows = [
      dr({ id: "a", pnl: 10, feesAvailable: false, qty: 1 }),
      dr({ id: "b", pnl: 20, feesAvailable: false, qty: 5 }),
      dr({ id: "c", pnl: -5, feesAvailable: false, qty: 2 }),
    ];
    const abh = 22.37; // gross 25 → total fees -2.63
    const out = resolveDayRowNets(rows, abh);
    const sumNet = out.get("a")!.net! + out.get("b")!.net! + out.get("c")!.net!;
    assert.ok(Math.abs(sumNet - abh) < 1e-9, `sum of nets must equal ABH ${abh}, got ${sumNet}`);
  });
});

describe("resolveDayRowNets — mixed exact + derived in one day", () => {
  it("exact rows keep exact fees; remaining ABH net allocated to derived rows; day reconciles", () => {
    const rows = [
      dr({ id: "exact", pnl: 5, netPnl: 4.2, fees: 0.8, feesAvailable: true, qty: 1 }),
      dr({ id: "deriv", pnl: 10, feesAvailable: false, qty: 2 }),
    ];
    // ABH day net = 12.0 → exact net 4.2, remaining net 7.8, derived gross 10 →
    // derived fees -2.2.
    const out = resolveDayRowNets(rows, 12.0);
    assert.equal(out.get("exact")!.feeSource, "exact");
    assert.equal(out.get("deriv")!.feeSource, "account-balance-derived");
    assert.ok(Math.abs(out.get("deriv")!.fees! - -2.2) < 1e-9, `derived fee -2.20, got ${out.get("deriv")!.fees}`);
    const sumNet = out.get("exact")!.net! + out.get("deriv")!.net!;
    assert.ok(Math.abs(sumNet - 12.0) < 1e-9, `day must reconcile to ABH 12.00, got ${sumNet}`);
  });
});

describe("resolveDayRowNets — undeterminable (no exact fees, no ABH net)", () => {
  it("returns null fees/net and null feeSource — never fabricated", () => {
    const out = resolveDayRowNets(
      [dr({ id: "x", pnl: 1.5, feesAvailable: false, qty: 1 })],
      undefined,
    );
    const r = out.get("x")!;
    assert.equal(r.fees, null);
    assert.equal(r.net, null);
    assert.equal(r.feeSource, null);
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
