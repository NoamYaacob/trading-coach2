import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  validateDirectionPrices,
  validateUnrealisticPrices,
  formatPnlBreakdown,
  parseNumericInput,
  validateNonNegativeField,
  toggleSign,
} from "./trade-entry-validation.ts";
import { FUTURES_SPECS, calculateFuturesPnl } from "./instruments.ts";

// ── Direction validation ───────────────────────────────────────────────────────

describe("validateDirectionPrices", () => {
  // Long: invalid cases
  it("Long: target below entry is invalid", () => {
    const errs = validateDirectionPrices({
      direction: "LONG",
      entryPrice: 25000,
      stopPrice: null,
      targetPrice: 24900,
    });
    assert.equal(errs.length, 1);
    assert.equal(errs[0].field, "targetPrice");
    assert.ok(errs[0].message.includes("Long target must be above"));
    assert.equal(errs[0].severity, "error");
  });

  it("Long: target equal to entry is invalid", () => {
    const errs = validateDirectionPrices({
      direction: "LONG",
      entryPrice: 25000,
      stopPrice: null,
      targetPrice: 25000,
    });
    assert.equal(errs.length, 1);
    assert.equal(errs[0].field, "targetPrice");
  });

  it("Long: stop above entry is invalid", () => {
    const errs = validateDirectionPrices({
      direction: "LONG",
      entryPrice: 25000,
      stopPrice: 25100,
      targetPrice: null,
    });
    assert.equal(errs.length, 1);
    assert.equal(errs[0].field, "stopPrice");
    assert.ok(errs[0].message.includes("Long stop must be below"));
  });

  it("Long: stop equal to entry is invalid", () => {
    const errs = validateDirectionPrices({
      direction: "LONG",
      entryPrice: 25000,
      stopPrice: 25000,
      targetPrice: null,
    });
    assert.equal(errs.length, 1);
    assert.equal(errs[0].field, "stopPrice");
  });

  // Short: invalid cases
  it("Short: target above entry is invalid", () => {
    const errs = validateDirectionPrices({
      direction: "SHORT",
      entryPrice: 25000,
      stopPrice: null,
      targetPrice: 25100,
    });
    assert.equal(errs.length, 1);
    assert.equal(errs[0].field, "targetPrice");
    assert.ok(errs[0].message.includes("Short target must be below"));
  });

  it("Short: target equal to entry is invalid", () => {
    const errs = validateDirectionPrices({
      direction: "SHORT",
      entryPrice: 25000,
      stopPrice: null,
      targetPrice: 25000,
    });
    assert.equal(errs.length, 1);
    assert.equal(errs[0].field, "targetPrice");
  });

  it("Short: stop below entry is invalid", () => {
    const errs = validateDirectionPrices({
      direction: "SHORT",
      entryPrice: 25000,
      stopPrice: 24900,
      targetPrice: null,
    });
    assert.equal(errs.length, 1);
    assert.equal(errs[0].field, "stopPrice");
    assert.ok(errs[0].message.includes("Short stop must be above"));
  });

  it("Short: stop equal to entry is invalid", () => {
    const errs = validateDirectionPrices({
      direction: "SHORT",
      entryPrice: 25000,
      stopPrice: 25000,
      targetPrice: null,
    });
    assert.equal(errs.length, 1);
    assert.equal(errs[0].field, "stopPrice");
  });

  // Valid cases
  it("Valid long: target above entry, stop below entry", () => {
    const errs = validateDirectionPrices({
      direction: "LONG",
      entryPrice: 25000,
      stopPrice: 24950,
      targetPrice: 25100,
    });
    assert.equal(errs.length, 0);
  });

  it("Valid short: target below entry, stop above entry", () => {
    const errs = validateDirectionPrices({
      direction: "SHORT",
      entryPrice: 25000,
      stopPrice: 25050,
      targetPrice: 24900,
    });
    assert.equal(errs.length, 0);
  });

  it("No entry price: no errors returned", () => {
    const errs = validateDirectionPrices({
      direction: "LONG",
      entryPrice: null,
      stopPrice: 24900,
      targetPrice: 25100,
    });
    assert.equal(errs.length, 0);
  });

  it("Both stop and target wrong for long: returns two errors", () => {
    const errs = validateDirectionPrices({
      direction: "LONG",
      entryPrice: 25000,
      stopPrice: 25100,
      targetPrice: 24900,
    });
    assert.equal(errs.length, 2);
  });
});

// ── Unrealistic price validation ──────────────────────────────────────────────

describe("validateUnrealisticPrices", () => {
  it("NQ entry 25000, exit 2502 is invalid (~90% away)", () => {
    const errs = validateUnrealisticPrices({
      entryPrice: 25000,
      prices: [{ field: "exitPrice", value: 2502, label: "Exit price" }],
    });
    assert.equal(errs.length, 1);
    assert.equal(errs[0].field, "exitPrice");
    assert.ok(errs[0].message.includes("20%"));
    assert.equal(errs[0].severity, "error");
  });

  it("NQ entry 25000, exit 25020 is valid (~0.08% away)", () => {
    const errs = validateUnrealisticPrices({
      entryPrice: 25000,
      prices: [{ field: "exitPrice", value: 25020, label: "Exit price" }],
    });
    assert.equal(errs.length, 0);
  });

  it("Entry 25000, exit at exactly 20% boundary is not flagged", () => {
    // threshold is strictly > 0.20, so exactly 20% (30000) is valid
    const errs = validateUnrealisticPrices({
      entryPrice: 25000,
      prices: [{ field: "exitPrice", value: 30000, label: "Exit price" }],
    });
    assert.equal(errs.length, 0);
  });

  it("Entry 25000, exit one tick past 20% boundary is flagged", () => {
    const errs = validateUnrealisticPrices({
      entryPrice: 25000,
      prices: [{ field: "exitPrice", value: 30001, label: "Exit price" }],
    });
    assert.equal(errs.length, 1);
  });

  it("Null price is skipped without error", () => {
    const errs = validateUnrealisticPrices({
      entryPrice: 25000,
      prices: [{ field: "exitPrice", value: null, label: "Exit price" }],
    });
    assert.equal(errs.length, 0);
  });

  it("Stop and target both flagged when both are unrealistic", () => {
    const errs = validateUnrealisticPrices({
      entryPrice: 25000,
      prices: [
        { field: "stopPrice", value: 1000, label: "Stop price" },
        { field: "targetPrice", value: 50000, label: "Target price" },
      ],
    });
    assert.equal(errs.length, 2);
  });

  it("Custom threshold: 10% catch catches 15% deviation", () => {
    const errs = validateUnrealisticPrices({
      entryPrice: 25000,
      prices: [{ field: "exitPrice", value: 28750, label: "Exit price" }], // 15% away
      thresholdFraction: 0.10,
    });
    assert.equal(errs.length, 1);
  });
});

// ── P&L calculations (via calculateFuturesPnl from instruments.ts) ────────────

describe("calculateFuturesPnl — required scenarios", () => {
  it("MNQ long entry 25000, exit 25020, qty 10 → gross $400", () => {
    const spec = FUTURES_SPECS["MNQ"]!;
    // pointValue = 2, price diff = 20, qty = 10 → 20 × 1 × 10 × 2 = 400
    const gross = calculateFuturesPnl({
      spec,
      direction: "LONG",
      entryPrice: 25000,
      exitPrice: 25020,
      quantity: 10,
    });
    assert.equal(gross, 400);
  });

  it("MNQ long entry 25000, exit 25020, qty 10, fees 1.50 → net $398.50", () => {
    const spec = FUTURES_SPECS["MNQ"]!;
    const gross = calculateFuturesPnl({
      spec,
      direction: "LONG",
      entryPrice: 25000,
      exitPrice: 25020,
      quantity: 10,
    });
    assert.equal(gross - 1.5, 398.5);
  });

  it("NQ long entry 25000, exit 25020, qty 1 → gross $400", () => {
    const spec = FUTURES_SPECS["NQ"]!;
    // pointValue = 20, price diff = 20, qty = 1 → 20 × 1 × 1 × 20 = 400
    const gross = calculateFuturesPnl({
      spec,
      direction: "LONG",
      entryPrice: 25000,
      exitPrice: 25020,
      quantity: 1,
    });
    assert.equal(gross, 400);
  });

  it("NQ long entry 25000, exit 25020, qty 1, fees 1.50 → net $398.50", () => {
    const spec = FUTURES_SPECS["NQ"]!;
    const gross = calculateFuturesPnl({
      spec,
      direction: "LONG",
      entryPrice: 25000,
      exitPrice: 25020,
      quantity: 1,
    });
    assert.equal(gross - 1.5, 398.5);
  });

  it("Long exit below entry gives negative P&L", () => {
    const spec = FUTURES_SPECS["NQ"]!;
    const gross = calculateFuturesPnl({
      spec,
      direction: "LONG",
      entryPrice: 25000,
      exitPrice: 24980,
      quantity: 1,
    });
    assert.ok(gross < 0, `Expected negative, got ${gross}`);
    assert.equal(gross, -400);
  });

  it("Short exit below entry gives positive P&L", () => {
    const spec = FUTURES_SPECS["NQ"]!;
    const gross = calculateFuturesPnl({
      spec,
      direction: "SHORT",
      entryPrice: 25000,
      exitPrice: 24980,
      quantity: 1,
    });
    assert.ok(gross > 0, `Expected positive, got ${gross}`);
    assert.equal(gross, 400);
  });

  it("Short exit above entry gives negative P&L", () => {
    const spec = FUTURES_SPECS["NQ"]!;
    const gross = calculateFuturesPnl({
      spec,
      direction: "SHORT",
      entryPrice: 25000,
      exitPrice: 25020,
      quantity: 1,
    });
    assert.ok(gross < 0, `Expected negative, got ${gross}`);
    assert.equal(gross, -400);
  });
});

// ── formatPnlBreakdown ─────────────────────────────────────────────────────────

describe("formatPnlBreakdown", () => {
  it("formats positive gross with fees and net", () => {
    const s = formatPnlBreakdown(400, 1.5, 398.5);
    assert.ok(s.includes("Gross: +$400.00"), `got: ${s}`);
    assert.ok(s.includes("Fees: $1.50"), `got: ${s}`);
    assert.ok(s.includes("Net: +$398.50"), `got: ${s}`);
  });

  it("formats negative gross", () => {
    const s = formatPnlBreakdown(-400, 1.5, -401.5);
    assert.ok(s.includes("Gross: −$400.00"), `got: ${s}`);
    assert.ok(s.includes("Fees: $1.50"), `got: ${s}`);
    assert.ok(s.includes("Net: −$401.50"), `got: ${s}`);
  });

  it("zero fees still shown", () => {
    const s = formatPnlBreakdown(400, 0, 400);
    assert.ok(s.includes("Fees: $0.00"), `got: ${s}`);
  });
});

// ── parseNumericInput ──────────────────────────────────────────────────────────

describe("parseNumericInput", () => {
  it("parses a negative value", () => {
    assert.equal(parseNumericInput("-120"), -120);
  });

  it("parses a negative decimal value", () => {
    assert.equal(parseNumericInput("-120.50"), -120.5);
  });

  it("parses a positive value", () => {
    assert.equal(parseNumericInput("150.25"), 150.25);
  });

  it("parses zero", () => {
    assert.equal(parseNumericInput("0"), 0);
  });

  it("returns null for empty string", () => {
    assert.equal(parseNumericInput(""), null);
  });

  it("returns null for lone minus sign (intermediate state)", () => {
    assert.equal(parseNumericInput("-"), null);
  });

  it("returns null for non-numeric 'abc'", () => {
    assert.equal(parseNumericInput("abc"), null);
  });

  it("returns null for double minus '--120'", () => {
    assert.equal(parseNumericInput("--120"), null);
  });
});

// ── validateNonNegativeField ───────────────────────────────────────────────────

describe("validateNonNegativeField", () => {
  it("negative quantity is rejected", () => {
    const msg = validateNonNegativeField(-1, "Quantity");
    assert.ok(msg !== null);
    assert.ok(msg!.includes("Quantity"));
  });

  it("negative fees are rejected", () => {
    const msg = validateNonNegativeField(-0.01, "Fees");
    assert.ok(msg !== null);
    assert.ok(msg!.includes("Fees"));
  });

  it("zero is accepted", () => {
    assert.equal(validateNonNegativeField(0, "Quantity"), null);
  });

  it("positive value is accepted", () => {
    assert.equal(validateNonNegativeField(5, "Quantity"), null);
  });

  it("null is accepted (field not yet entered)", () => {
    assert.equal(validateNonNegativeField(null, "Quantity"), null);
  });
});

// ── toggleSign ────────────────────────────────────────────────────────────────

describe("toggleSign", () => {
  it("empty string becomes '-'", () => {
    assert.equal(toggleSign(""), "-");
  });

  it("lone '-' becomes empty string", () => {
    assert.equal(toggleSign("-"), "");
  });

  it("positive '120' becomes '-120'", () => {
    assert.equal(toggleSign("120"), "-120");
  });

  it("negative '-120' becomes '120'", () => {
    assert.equal(toggleSign("-120"), "120");
  });

  it("positive decimal '120.50' becomes '-120.50'", () => {
    assert.equal(toggleSign("120.50"), "-120.50");
  });

  it("negative decimal '-120.50' becomes '120.50'", () => {
    assert.equal(toggleSign("-120.50"), "120.50");
  });

  it("double toggle returns to original for '250'", () => {
    assert.equal(toggleSign(toggleSign("250")), "250");
  });
});
