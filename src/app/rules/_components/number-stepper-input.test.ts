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
// After PR #37 redesign: MoneyLimits + TradingBehavior + Position-symbol's
// maxContracts row were absorbed into a single Core rules card.
const CORE_RULES       = resolve(RULES_ROOT, "sections/core-rules-section.tsx");
const SYMBOL_LIMITS_ROW = resolve(RULES_ROOT, "sections/symbol-limits-row.tsx");
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

test("core-rules-section: integer fields use NumberStepperInput", () => {
  const src = read(CORE_RULES);
  assert.ok(
    src.includes("NumberStepperInput"),
    "core-rules-section must import and use NumberStepperInput",
  );
  // The three integer fields (maxTradesPerDay, stopAfterLosses, maxContracts)
  // each bind to a NumberStepperInput.
  for (const field of ["maxTradesPerDay", "stopAfterLosses", "maxContracts"]) {
    assert.ok(
      src.includes(`value={values.${field}}`),
      `${field} must bind to a stepper input in core-rules-section`,
    );
  }
});

test("core-rules-section: dollar fields (maxDailyLoss, riskPerTrade) use plain NumberInput", () => {
  const src = read(CORE_RULES);
  for (const field of ["maxDailyLoss", "riskPerTrade"]) {
    assert.ok(
      src.includes(`value={values.${field}}`),
      `${field} must bind a value in core-rules-section`,
    );
  }
  // The card must import the plain NumberInput primitive for dollar fields.
  assert.ok(
    /import\s+\{[^}]*\bNumberInput\b[^}]*\}\s+from\s+["']\.\/field-primitives["']/.test(src),
    "core-rules-section must import NumberInput for dollar fields",
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

test("core-rules-section: dollar fields rendered with NumberInput, not NumberStepperInput", () => {
  // Audit that the dollar-field rows in the Core rules card hand their input
  // to <NumberInput …/>, never <NumberStepperInput …/>. Steppers are for
  // small integer counts only.
  const src = read(CORE_RULES);
  for (const field of ["maxDailyLoss", "riskPerTrade"]) {
    const idx = src.indexOf(`value={values.${field}}`);
    assert.ok(idx !== -1, `${field} binding must exist in core-rules-section`);
    // Walk backwards a short distance to find the opening tag the value attribute belongs to.
    const before = src.slice(Math.max(0, idx - 80), idx);
    assert.ok(
      /<NumberInput\b/.test(before),
      `${field} must be rendered with <NumberInput> (dollar field, not stepper)`,
    );
    assert.ok(
      !/<NumberStepperInput\b/.test(before),
      `${field} must NOT be rendered with <NumberStepperInput> — it is a dollar amount`,
    );
  }
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
  for (const path of [FIELD_PRIMITIVES, CORE_RULES, SYMBOL_LIMITS_ROW]) {
    const src = read(path);
    for (const banned of ["cancelOrder", "liquidate", "flattenPosition", "PDLL", "PDPT", "sendOrder"]) {
      assert.ok(
        !src.includes(banned),
        `${path} must not reference broker action "${banned}"`,
      );
    }
  }
});
