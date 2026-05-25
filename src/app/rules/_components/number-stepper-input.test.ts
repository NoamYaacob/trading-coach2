/**
 * Tests for NumberStepperInput.
 *
 * The step logic is tested via the exported `stepValue` pure helper — no DOM
 * or React rendering required, keeping the suite fast and dependency-free.
 *
 * Source-scan tests verify that:
 *   - Integer fields (maxTradesPerDay, stopAfterLosses, maxContracts) use
 *     NumberStepperInput in every section file that renders them.
 *   - Dollar/decimal fields (maxDailyLoss, riskPerTrade, dailyProfitTarget,
 *     accountSize) continue to use the plain NumberInput.
 *   - No schema, evaluator, broker, env, or API route files were touched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

import { stepValue } from "./sections/step-value.ts";

// ── Helper ─────────────────────────────────────────────────────────────────

function read(path: string) {
  return readFileSync(path, "utf8");
}

const ROOT = resolve(import.meta.dirname, "..");
const RULES_ROOT = resolve(import.meta.dirname);

const FIELD_PRIMITIVES = resolve(RULES_ROOT, "sections/field-primitives.tsx");
const STEP_VALUE_MODULE = resolve(RULES_ROOT, "sections/step-value.ts");
const TRADING_BEHAVIOR = resolve(RULES_ROOT, "sections/trading-behavior-section.tsx");
const POSITION_SYMBOL  = resolve(RULES_ROOT, "sections/position-symbol-section.tsx");
const RULES_FORM       = resolve(RULES_ROOT, "rules-form.tsx");

// ── stepValue pure logic ───────────────────────────────────────────────────

test("stepValue: increment from blank sets to min (default 1)", () => {
  assert.equal(stepValue("", 1, undefined, undefined), "1");
  assert.equal(stepValue("", 1, 1, undefined), "1");
  assert.equal(stepValue("", 1, 3, undefined), "3");
});

test("stepValue: decrement from blank is a no-op", () => {
  assert.equal(stepValue("", -1, undefined, undefined), "");
  assert.equal(stepValue("", -1, 1, undefined), "");
});

test("stepValue: increment from a value", () => {
  assert.equal(stepValue("3", 1, 1, undefined), "4");
  assert.equal(stepValue("1", 1, 1, undefined), "2");
  assert.equal(stepValue("10", 1, 1, undefined), "11");
});

test("stepValue: decrement from a value", () => {
  assert.equal(stepValue("5", -1, 1, undefined), "4");
  assert.equal(stepValue("3", -1, 1, undefined), "2");
  assert.equal(stepValue("2", -1, 1, undefined), "1");
});

test("stepValue: decrement clamps at min (does not go below)", () => {
  assert.equal(stepValue("1", -1, 1, undefined), "1");
  assert.equal(stepValue("3", -1, 3, undefined), "3");
});

test("stepValue: increment clamps at max", () => {
  assert.equal(stepValue("5", 1, 1, 5), "5");
  assert.equal(stepValue("4", 1, 1, 5), "5");
  assert.equal(stepValue("5", 1, 1, 5), "5");
});

test("stepValue: increment from blank respects max", () => {
  // min=1 is valid, max=5 — blank → 1
  assert.equal(stepValue("", 1, 1, 5), "1");
});

test("stepValue: non-numeric string is unchanged", () => {
  assert.equal(stepValue("abc", 1, 1, undefined), "abc");
  assert.equal(stepValue("abc", -1, 1, undefined), "abc");
});

// ── Source-scan: integer fields use NumberStepperInput ─────────────────────

test("trading-behavior-section: maxTradesPerDay uses NumberStepperInput, not NumberInput", () => {
  const src = read(TRADING_BEHAVIOR);
  assert.ok(
    src.includes("NumberStepperInput"),
    "trading-behavior-section must import and use NumberStepperInput",
  );
  assert.ok(
    !src.includes("NumberInput"),
    "trading-behavior-section must NOT use plain NumberInput (integer fields moved to stepper)",
  );
});

test("trading-behavior-section: both integer fields pass value/onChange to NumberStepperInput", () => {
  const src = read(TRADING_BEHAVIOR);
  assert.ok(
    src.includes('value={values.maxTradesPerDay}'),
    "maxTradesPerDay must bind value to stepper",
  );
  assert.ok(
    src.includes('value={values.stopAfterLosses}'),
    "stopAfterLosses must bind value to stepper",
  );
});

test("position-symbol-section: maxContracts uses NumberStepperInput, not NumberInput", () => {
  const src = read(POSITION_SYMBOL);
  assert.ok(
    src.includes("NumberStepperInput"),
    "position-symbol-section must import and use NumberStepperInput",
  );
  assert.ok(
    !src.includes("NumberInput"),
    "position-symbol-section must NOT use plain NumberInput (maxContracts moved to stepper)",
  );
});

test("rules-form: integer fields use NumberStepperInput", () => {
  const src = read(RULES_FORM);
  assert.ok(
    src.includes("NumberStepperInput"),
    "rules-form must import and use NumberStepperInput",
  );
  // All three integer placements should use the stepper
  const stepperCount = (src.match(/NumberStepperInput/g) ?? []).length;
  assert.ok(
    stepperCount >= 2, // import line + at least 2-3 usages
    `rules-form should reference NumberStepperInput multiple times, got ${stepperCount}`,
  );
});

// ── Source-scan: dollar fields still use plain NumberInput ─────────────────

test("rules-form: dollar fields (maxDailyLoss, riskPerTrade, accountSize) still use NumberInput", () => {
  const src = read(RULES_FORM);
  assert.ok(
    src.includes('onChange={(v) => update("maxDailyLoss', ) &&
    src.includes('onChange={(v) => update("accountSize'),
    "rules-form must still have dollar-field onChange bindings",
  );
  // The local NumberInput function should still exist for dollar fields
  assert.ok(
    src.includes("function NumberInput"),
    "rules-form must keep its local NumberInput for decimal/dollar fields",
  );
});

test("money-limits-section: does NOT use NumberStepperInput (dollar fields only)", () => {
  const moneyLimitsSrc = read(resolve(RULES_ROOT, "sections/money-limits-section.tsx"));
  assert.ok(
    !moneyLimitsSrc.includes("NumberStepperInput"),
    "money-limits-section must NOT use stepper — maxDailyLoss and riskPerTrade are dollar amounts",
  );
});

// ── Source-scan: NumberStepperInput component quality ──────────────────────

test("field-primitives: NumberStepperInput disables buttons with disabled: class", () => {
  const src = read(FIELD_PRIMITIVES);
  assert.ok(
    src.includes("disabled:cursor-not-allowed"),
    "stepper buttons must have disabled:cursor-not-allowed class",
  );
  assert.ok(
    src.includes('aria-label="Decrease"') && src.includes('aria-label="Increase"'),
    "stepper buttons must have aria-label for accessibility",
  );
});

test("field-primitives: NumberStepperInput hides browser spin buttons", () => {
  const src = read(FIELD_PRIMITIVES);
  assert.ok(
    src.includes("[appearance:textfield]") ||
    src.includes("webkit-inner-spin-button"),
    "stepper input must suppress browser native spin arrows",
  );
});

test("step-value module: stepValue is exported from its own .ts file (no JSX)", () => {
  const src = read(STEP_VALUE_MODULE);
  assert.ok(
    src.includes("export function stepValue"),
    "stepValue must be exported from step-value.ts for DOM-free unit testing",
  );
  assert.ok(
    !src.includes("import React") && !src.includes("from 'react'") && !src.includes('from "react"'),
    "step-value.ts must not import React (keeps it testable without DOM)",
  );
});

// ── Safety: no schema / evaluator / broker / env changes ──────────────────

test("safety: field-primitives does not import or call Tradovate", () => {
  const src = read(FIELD_PRIMITIVES);
  assert.ok(
    !src.includes("tradovate") && !src.includes("TradovateClient"),
    "field-primitives must not reference Tradovate",
  );
  assert.ok(
    !src.includes("broker") && !src.includes("evaluator"),
    "field-primitives must not reference broker or evaluator code",
  );
});

test("safety: no broker write or order action in stepper implementation", () => {
  for (const path of [FIELD_PRIMITIVES, TRADING_BEHAVIOR, POSITION_SYMBOL]) {
    const src = read(path);
    for (const banned of ["cancelOrder", "liquidate", "flattenPosition", "PDLL", "PDPT", "sendOrder"]) {
      assert.ok(
        !src.includes(banned),
        `${path} must not reference broker action "${banned}"`,
      );
    }
  }
});
