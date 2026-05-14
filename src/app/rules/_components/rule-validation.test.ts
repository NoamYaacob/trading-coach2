import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { validateRules, effectiveValue } from "./rule-validation.ts";

const empty = {
  maxDailyLoss: "",
  riskPerTrade: "",
  maxTradesPerDay: "",
  stopAfterLosses: "",
} as const;

// ── No errors when fields are blank ───────────────────────────────────────────

describe("validateRules — blank inputs", () => {
  it("all blank → no errors (inputs make no claim)", () => {
    assert.deepEqual(validateRules({ ...empty }), []);
  });

  it("only one of a pair filled → no comparison error", () => {
    assert.deepEqual(
      validateRules({ ...empty, maxDailyLoss: "300" }),
      [],
    );
    assert.deepEqual(
      validateRules({ ...empty, riskPerTrade: "100" }),
      [],
    );
    assert.deepEqual(
      validateRules({ ...empty, maxTradesPerDay: "5" }),
      [],
    );
    assert.deepEqual(
      validateRules({ ...empty, stopAfterLosses: "3" }),
      [],
    );
  });
});

// ── Risk per trade vs daily loss ──────────────────────────────────────────────

describe("validateRules — riskPerTrade vs maxDailyLoss", () => {
  it("riskPerTrade > maxDailyLoss → error", () => {
    const errs = validateRules({ ...empty, maxDailyLoss: "300", riskPerTrade: "400" });
    assert.equal(errs.length, 1);
    assert.equal(errs[0].field, "riskPerTrade");
    assert.match(errs[0].message, /risk per trade cannot be higher than daily loss limit/i);
  });

  it("riskPerTrade === maxDailyLoss → no error (boundary allowed)", () => {
    const errs = validateRules({ ...empty, maxDailyLoss: "300", riskPerTrade: "300" });
    assert.deepEqual(errs, []);
  });

  it("riskPerTrade < maxDailyLoss → no error", () => {
    const errs = validateRules({ ...empty, maxDailyLoss: "300", riskPerTrade: "100" });
    assert.deepEqual(errs, []);
  });

  it("decimal values are compared correctly", () => {
    const errs = validateRules({ ...empty, maxDailyLoss: "100.5", riskPerTrade: "100.6" });
    assert.equal(errs.length, 1);
    assert.equal(errs[0].field, "riskPerTrade");
  });
});

// ── Stop after losses vs max trades ───────────────────────────────────────────

describe("validateRules — stopAfterLosses vs maxTradesPerDay", () => {
  it("stopAfterLosses > maxTradesPerDay → error", () => {
    const errs = validateRules({ ...empty, maxTradesPerDay: "2", stopAfterLosses: "4" });
    assert.equal(errs.length, 1);
    assert.equal(errs[0].field, "stopAfterLosses");
    assert.match(errs[0].message, /stop after losses cannot be higher than max trades per day/i);
  });

  it("stopAfterLosses === maxTradesPerDay → no error (boundary allowed)", () => {
    const errs = validateRules({ ...empty, maxTradesPerDay: "3", stopAfterLosses: "3" });
    assert.deepEqual(errs, []);
  });

  it("stopAfterLosses < maxTradesPerDay → no error", () => {
    const errs = validateRules({ ...empty, maxTradesPerDay: "5", stopAfterLosses: "3" });
    assert.deepEqual(errs, []);
  });
});

// ── Non-positive values ───────────────────────────────────────────────────────

describe("validateRules — non-positive values blocked", () => {
  it("maxDailyLoss=0 → error", () => {
    const errs = validateRules({ ...empty, maxDailyLoss: "0" });
    assert.equal(errs.length, 1);
    assert.equal(errs[0].field, "maxDailyLoss");
  });

  it("maxDailyLoss=-1 → error", () => {
    const errs = validateRules({ ...empty, maxDailyLoss: "-1" });
    assert.equal(errs.length, 1);
    assert.equal(errs[0].field, "maxDailyLoss");
  });

  it("riskPerTrade=0 → error", () => {
    const errs = validateRules({ ...empty, riskPerTrade: "0" });
    assert.equal(errs.length, 1);
    assert.equal(errs[0].field, "riskPerTrade");
  });

  it("maxTradesPerDay=0 → error", () => {
    const errs = validateRules({ ...empty, maxTradesPerDay: "0" });
    assert.equal(errs.length, 1);
    assert.equal(errs[0].field, "maxTradesPerDay");
  });

  it("stopAfterLosses=0 → error", () => {
    const errs = validateRules({ ...empty, stopAfterLosses: "0" });
    assert.equal(errs.length, 1);
    assert.equal(errs[0].field, "stopAfterLosses");
  });
});

// ── Multiple errors are reported together ─────────────────────────────────────

describe("validateRules — multiple errors", () => {
  it("both invariants violated → both errors reported", () => {
    const errs = validateRules({
      maxDailyLoss: "300",
      riskPerTrade: "400",
      maxTradesPerDay: "2",
      stopAfterLosses: "4",
    });
    assert.equal(errs.length, 2);
    const fields = errs.map((e) => e.field).sort();
    assert.deepEqual(fields, ["riskPerTrade", "stopAfterLosses"].sort());
  });
});

// ── Valid combinations ────────────────────────────────────────────────────────

describe("validateRules — valid combinations", () => {
  it("typical funded-account values → no errors", () => {
    const errs = validateRules({
      maxDailyLoss: "1000",
      riskPerTrade: "200",
      maxTradesPerDay: "5",
      stopAfterLosses: "3",
    });
    assert.deepEqual(errs, []);
  });

  it("strict scalper values → no errors", () => {
    const errs = validateRules({
      maxDailyLoss: "300",
      riskPerTrade: "100",
      maxTradesPerDay: "3",
      stopAfterLosses: "2",
    });
    assert.deepEqual(errs, []);
  });
});

// ── effectiveValue helper ─────────────────────────────────────────────────────

describe("effectiveValue — account-vs-default fallback", () => {
  it("non-empty account value wins over default", () => {
    assert.equal(effectiveValue("16", "18"), "16");
  });

  it("blank account value falls back to default", () => {
    assert.equal(effectiveValue("", "18"), "18");
  });

  it("whitespace-only account value falls back to default", () => {
    assert.equal(effectiveValue("   ", "18"), "18");
  });

  it("blank account + missing default → empty string", () => {
    assert.equal(effectiveValue("", undefined), "");
  });

  it("blank account + empty-string default → empty string", () => {
    assert.equal(effectiveValue("", ""), "");
  });
});

// ── Effective-value validation: account form must catch invalid combos
//     even when one side is inherited from default ──────────────────────────────

describe("validateRules + effectiveValue — account override picks up inherited default", () => {
  it("account sets riskPerTrade=400, leaves daily loss blank, default daily loss=300 → invalid", () => {
    const errs = validateRules({
      maxDailyLoss: effectiveValue("", "300"),
      riskPerTrade: effectiveValue("400", "200"),
      maxTradesPerDay: effectiveValue("", "5"),
      stopAfterLosses: effectiveValue("", "3"),
    });
    assert.equal(errs.length, 1);
    assert.equal(errs[0].field, "riskPerTrade");
  });

  it("account sets stopAfterLosses=4, leaves trades blank, default trades=2 → invalid", () => {
    const errs = validateRules({
      maxDailyLoss: effectiveValue("", "1000"),
      riskPerTrade: effectiveValue("", "200"),
      maxTradesPerDay: effectiveValue("", "2"),
      stopAfterLosses: effectiveValue("4", "3"),
    });
    assert.equal(errs.length, 1);
    assert.equal(errs[0].field, "stopAfterLosses");
  });

  it("account override that fully replaces default with valid combo → no errors", () => {
    const errs = validateRules({
      maxDailyLoss: effectiveValue("500", "300"),
      riskPerTrade: effectiveValue("250", "100"),
      maxTradesPerDay: effectiveValue("10", "5"),
      stopAfterLosses: effectiveValue("4", "3"),
    });
    assert.deepEqual(errs, []);
  });
});
