import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  FUTURES_SPECS,
  calculateFuturesPnl,
  calculateFuturesRisk,
  calculateRMultiple,
  getInstrumentSpec,
  isFuturesSymbol,
  isValidFuturesQuantity,
  isValidTickPrice,
} from "./instruments.ts";

describe("getInstrumentSpec", () => {
  it("returns the spec for a known futures symbol", () => {
    const spec = getInstrumentSpec("ES");
    assert.ok(spec !== null);
    assert.equal(spec.kind, "futures");
  });

  it("is case-insensitive", () => {
    assert.ok(getInstrumentSpec("nq") !== null);
    assert.ok(getInstrumentSpec("Nq") !== null);
  });

  it("returns null for unknown symbols", () => {
    assert.equal(getInstrumentSpec("AAPL"), null);
    assert.equal(getInstrumentSpec(""), null);
  });

  it("trims whitespace before lookup", () => {
    assert.ok(getInstrumentSpec("  ES  ") !== null);
  });
});

describe("isFuturesSymbol", () => {
  it("returns true for all known futures", () => {
    for (const symbol of Object.keys(FUTURES_SPECS)) {
      assert.equal(isFuturesSymbol(symbol), true, `expected ${symbol} to be futures`);
    }
  });

  it("returns false for non-futures symbols", () => {
    assert.equal(isFuturesSymbol("AAPL"), false);
    assert.equal(isFuturesSymbol("BTC"), false);
  });
});

describe("isValidFuturesQuantity", () => {
  it("accepts positive integers", () => {
    assert.equal(isValidFuturesQuantity(1), true);
    assert.equal(isValidFuturesQuantity(2), true);
    assert.equal(isValidFuturesQuantity(10), true);
  });

  it("rejects zero", () => {
    assert.equal(isValidFuturesQuantity(0), false);
  });

  it("rejects negative integers", () => {
    assert.equal(isValidFuturesQuantity(-1), false);
    assert.equal(isValidFuturesQuantity(-10), false);
  });

  it("rejects fractional quantities", () => {
    assert.equal(isValidFuturesQuantity(1.5), false);
    assert.equal(isValidFuturesQuantity(0.5), false);
    assert.equal(isValidFuturesQuantity(-0.5), false);
  });
});

describe("getInstrumentSpec — unknown symbol returns null (manual mode)", () => {
  it("returns null for unrecognized symbols", () => {
    assert.equal(getInstrumentSpec("ABCD"), null);
    assert.equal(getInstrumentSpec("AAPL"), null);
    assert.equal(getInstrumentSpec("BTC"), null);
    assert.equal(getInstrumentSpec("EURUSD"), null);
  });
});

describe("isValidTickPrice", () => {
  it("accepts prices aligned to tick size", () => {
    // ES tick 0.25
    assert.equal(isValidTickPrice(5000.00, 0.25), true);
    assert.equal(isValidTickPrice(5000.25, 0.25), true);
    assert.equal(isValidTickPrice(5000.50, 0.25), true);
    assert.equal(isValidTickPrice(5000.75, 0.25), true);
    // NQ tick 0.25
    assert.equal(isValidTickPrice(26000.00, 0.25), true);
    assert.equal(isValidTickPrice(26020.00, 0.25), true);
    // YM tick 1
    assert.equal(isValidTickPrice(40000, 1), true);
    // CL tick 0.01
    assert.equal(isValidTickPrice(70.10, 0.01), true);
  });

  it("rejects prices not aligned to tick size", () => {
    // ES
    assert.equal(isValidTickPrice(5000.10, 0.25), false);
    assert.equal(isValidTickPrice(5000.33, 0.25), false);
    // NQ
    assert.equal(isValidTickPrice(26000.10, 0.25), false);
    // CL
    assert.equal(isValidTickPrice(70.123, 0.01), false);
  });
});

describe("calculateFuturesPnl", () => {
  const nq = FUTURES_SPECS["NQ"]!;
  const es = FUTURES_SPECS["ES"]!;
  const mes = FUTURES_SPECS["MES"]!;
  const mnq = FUTURES_SPECS["MNQ"]!;

  it("NQ long: entry 26000, exit 26020, qty 1 → $400", () => {
    const pnl = calculateFuturesPnl({
      spec: nq,
      direction: "LONG",
      entryPrice: 26000,
      exitPrice: 26020,
      quantity: 1,
    });
    assert.equal(pnl, 400);
  });

  it("ES short: entry 5000, exit 4998, qty 2 → $200", () => {
    const pnl = calculateFuturesPnl({
      spec: es,
      direction: "SHORT",
      entryPrice: 5000,
      exitPrice: 4998,
      quantity: 2,
    });
    assert.equal(pnl, 200);
  });

  it("NQ long losing trade returns negative P&L", () => {
    const pnl = calculateFuturesPnl({
      spec: nq,
      direction: "LONG",
      entryPrice: 26020,
      exitPrice: 26000,
      quantity: 1,
    });
    assert.equal(pnl, -400);
  });

  it("ES short losing trade returns negative P&L", () => {
    const pnl = calculateFuturesPnl({
      spec: es,
      direction: "SHORT",
      entryPrice: 4998,
      exitPrice: 5000,
      quantity: 2,
    });
    assert.equal(pnl, -200);
  });

  it("MES uses $5 point value", () => {
    const pnl = calculateFuturesPnl({
      spec: mes,
      direction: "LONG",
      entryPrice: 5000,
      exitPrice: 5010,
      quantity: 1,
    });
    assert.equal(pnl, 50);
  });

  it("MNQ uses $2 point value", () => {
    const pnl = calculateFuturesPnl({
      spec: mnq,
      direction: "LONG",
      entryPrice: 26000,
      exitPrice: 26020,
      quantity: 1,
    });
    assert.equal(pnl, 40);
  });

  it("scales linearly with quantity", () => {
    const single = calculateFuturesPnl({ spec: nq, direction: "LONG", entryPrice: 26000, exitPrice: 26020, quantity: 1 });
    const triple = calculateFuturesPnl({ spec: nq, direction: "LONG", entryPrice: 26000, exitPrice: 26020, quantity: 3 });
    assert.equal(triple, single * 3);
  });

  it("flat trade returns zero", () => {
    const pnl = calculateFuturesPnl({ spec: es, direction: "LONG", entryPrice: 5000, exitPrice: 5000, quantity: 1 });
    assert.equal(pnl, 0);
  });
});

describe("calculateFuturesRisk", () => {
  const nq = FUTURES_SPECS["NQ"]!;
  const es = FUTURES_SPECS["ES"]!;

  it("NQ long: entry 26000, stop 25980, qty 1 → $400", () => {
    const risk = calculateFuturesRisk({
      spec: nq,
      direction: "LONG",
      entryPrice: 26000,
      stopPrice: 25980,
      quantity: 1,
    });
    assert.equal(risk, 400);
  });

  it("ES short: entry 5000, stop 5010, qty 2 → $1000", () => {
    const risk = calculateFuturesRisk({
      spec: es,
      direction: "SHORT",
      entryPrice: 5000,
      stopPrice: 5010,
      quantity: 2,
    });
    assert.equal(risk, 1000);
  });

  it("risk is always positive regardless of stop above/below entry", () => {
    const riskBelow = calculateFuturesRisk({ spec: es, entryPrice: 5000, stopPrice: 4990, quantity: 1 });
    const riskAbove = calculateFuturesRisk({ spec: es, entryPrice: 4990, stopPrice: 5000, quantity: 1 });
    assert.equal(riskBelow, riskAbove);
    assert.ok(riskBelow > 0);
  });

  it("zero stop distance returns zero risk", () => {
    const risk = calculateFuturesRisk({ spec: es, entryPrice: 5000, stopPrice: 5000, quantity: 1 });
    assert.equal(risk, 0);
  });
});

describe("calculateRMultiple", () => {
  it("positive trade: R = pnl / risk", () => {
    const r = calculateRMultiple({ pnl: 400, riskAmount: 200 });
    assert.equal(r, 2);
  });

  it("losing trade: R is negative", () => {
    const r = calculateRMultiple({ pnl: -200, riskAmount: 200 });
    assert.equal(r, -1);
  });

  it("breakeven returns 0R", () => {
    const r = calculateRMultiple({ pnl: 0, riskAmount: 200 });
    assert.equal(r, 0);
  });

  it("zero risk returns null", () => {
    assert.equal(calculateRMultiple({ pnl: 400, riskAmount: 0 }), null);
  });

  it("negative risk returns null", () => {
    assert.equal(calculateRMultiple({ pnl: 400, riskAmount: -100 }), null);
  });
});
