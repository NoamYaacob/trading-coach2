import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveDayNet, type DayTradeRow } from "./day-net.ts";

function r(over: Partial<DayTradeRow>): DayTradeRow {
  return {
    pnl: over.pnl ?? 1.5,
    netPnl: over.netPnl ?? over.pnl ?? 1.5,
    feesAvailable: over.feesAvailable ?? false,
  };
}

describe("resolveDayNet", () => {
  it("the 1868411 case: broker day net -0.40 is authoritative even with fees missing per-trade", () => {
    // Row-level: Trade P&L +1.50, fees Not reported. Broker Cash History day net = -0.40.
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
