/**
 * Unit tests for the riskRulesData transformation helper.
 *
 * Pure function: API body → AccountRiskRules DB column shape.
 * No network, no DB, no framework.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { riskRulesData } from "./risk-rules-data.ts";

describe("riskRulesData — maxContracts", () => {
  it("passes through a positive account-specific maxContracts", () => {
    assert.equal(riskRulesData({ maxContracts: 3 }).maxContracts, 3);
  });

  it("passes through maxContracts=1", () => {
    assert.equal(riskRulesData({ maxContracts: 1 }).maxContracts, 1);
  });

  it("passes through maxContracts=10", () => {
    assert.equal(riskRulesData({ maxContracts: 10 }).maxContracts, 10);
  });

  it("null clears the field (account falls back to default template at enforcement time)", () => {
    assert.equal(riskRulesData({ maxContracts: null }).maxContracts, null);
  });

  it("absent field defaults to null (no override stored)", () => {
    assert.equal(riskRulesData({}).maxContracts, null);
  });

  it("zero is stored as-is (sync treats 0 as unconfigured at enforcement time)", () => {
    assert.equal(riskRulesData({ maxContracts: 0 }).maxContracts, 0);
  });
});

describe("riskRulesData — maxContracts does not corrupt other fields", () => {
  it("unset fields default to null when only maxContracts is provided", () => {
    const result = riskRulesData({ maxContracts: 5 });
    assert.equal(result.maxDailyLoss, null);
    assert.equal(result.maxTradesPerDay, null);
    assert.equal(result.stopAfterLosses, null);
    assert.equal(result.allowedEndHour, null);
    assert.equal(result.sessionEndBehavior, null);
  });

  it("existing fields are preserved alongside maxContracts", () => {
    const result = riskRulesData({
      maxContracts: 2,
      maxDailyLoss: 500,
      stopAfterLosses: 3,
    });
    assert.equal(result.maxContracts, 2);
    assert.equal(result.maxDailyLoss, "500");
    assert.equal(result.stopAfterLosses, 3);
  });
});

describe("riskRulesData — daily profit target is NOT account-specific", () => {
  it("dailyProfitTarget is absent from the account-rules transformation output", () => {
    // The Trading Plan account-specific form has no profit-target field, and the
    // server transformation omits it on purpose so account overrides cannot
    // accidentally store one. Profit target lives on the default template only.
    const result = riskRulesData({} as Parameters<typeof riskRulesData>[0]);
    assert.ok(
      !Object.prototype.hasOwnProperty.call(result, "dailyProfitTarget"),
      "riskRulesData output must not include dailyProfitTarget",
    );
  });

  it("ignores dailyProfitTarget if smuggled into the body — account-specific overrides cannot store it", () => {
    const result = riskRulesData({
      maxDailyLoss: 500,
      // @ts-expect-error — field is intentionally not on RiskRulesBody
      dailyProfitTarget: 1000,
    });
    assert.ok(
      !Object.prototype.hasOwnProperty.call(result, "dailyProfitTarget"),
      "riskRulesData must drop dailyProfitTarget even if a client sends it",
    );
  });
});

describe("riskRulesData — account override isolation", () => {
  it("transforming account A's body produces only account A's column shape", () => {
    // The function is pure — same input always produces same output regardless
    // of which account the caller intends to save to. Caller-side scoping
    // (where: { accountId }) is what guarantees per-account isolation.
    const a = riskRulesData({ maxDailyLoss: 500, allowedEndHour: 16 });
    const b = riskRulesData({ maxDailyLoss: 1000, allowedEndHour: 18 });
    assert.notEqual(a.maxDailyLoss, b.maxDailyLoss);
    assert.notEqual(a.allowedEndHour, b.allowedEndHour);
    // Mutating one snapshot must not affect the other (no shared object refs).
    (a as Record<string, unknown>).maxDailyLoss = "999";
    assert.equal(b.maxDailyLoss, "1000");
  });

  it("cutoff (allowedEndHour) round-trips as an account-level integer override", () => {
    // Account override: cutoff at 16. Default template lives in a separate
    // table (RiskRules.sessionEndHour) and is not touched by this helper.
    const result = riskRulesData({ allowedEndHour: 16 });
    assert.equal(result.allowedEndHour, 16);
    // riskRulesData has no concept of "default" — it only emits the
    // AccountRiskRules columns. There is no sessionEndHour key in the output.
    assert.ok(
      !Object.prototype.hasOwnProperty.call(result, "sessionEndHour"),
      "account body must not produce sessionEndHour (that's the default template column)",
    );
  });

  it("allowedEndHour=15 stores 15 (CME hour 3:00 PM CT)", () => {
    assert.equal(riskRulesData({ allowedEndHour: 15 }).allowedEndHour, 15);
  });

  it("allowedEndHour=null stores null (account inherits default cutoff at enforcement time)", () => {
    assert.equal(riskRulesData({ allowedEndHour: null }).allowedEndHour, null);
  });

  it("cutoff null does not erase unrelated account-specific fields", () => {
    const result = riskRulesData({
      allowedEndHour: null,
      maxDailyLoss: 500,
      stopAfterLosses: 3,
      maxContracts: 2,
    });
    assert.equal(result.allowedEndHour, null);
    assert.equal(result.maxDailyLoss, "500");
    assert.equal(result.stopAfterLosses, 3);
    assert.equal(result.maxContracts, 2);
  });

  it("absent allowedEndHour defaults to null (dropdown shows 'No cutoff' → inherited)", () => {
    assert.equal(riskRulesData({}).allowedEndHour, null);
  });
});

describe("riskRulesData — enforcement truth", () => {
  it("output contains no tradovate_* or broker_* keys (this helper has no broker side-effects)", () => {
    const result = riskRulesData({ maxDailyLoss: 500, allowedEndHour: 16 });
    const keys = Object.keys(result);
    const brokerKeys = keys.filter((k) => /tradovate|broker/i.test(k));
    assert.deepEqual(
      brokerKeys,
      [],
      "riskRulesData is a pure DB-column mapper; it must not include broker API fields",
    );
  });

  it("the account-specific form never writes sessionEndHour (default template column)", () => {
    // sessionEndHour lives on RiskRules (default template).
    // allowedEndHour lives on AccountRiskRules (account override).
    // Saving account rules must never bleed into the default template.
    const result = riskRulesData({ maxDailyLoss: 500, allowedEndHour: 14, ruleEditLockBufferMinutes: 30 });
    assert.ok(!Object.prototype.hasOwnProperty.call(result, "sessionEndHour"));
    assert.ok(!Object.prototype.hasOwnProperty.call(result, "sessionStartHour"));
    assert.equal(result.allowedEndHour, 14);
  });
});

describe("riskRulesData — maxContractsBySymbolJson (Phase 4)", () => {
  it("passes through a symbol-limits JSON string", () => {
    const json = '[{"symbol":"NQ","maxContracts":2}]';
    assert.equal(riskRulesData({ maxContractsBySymbolJson: json }).maxContractsBySymbolJson, json);
  });

  it("maps an absent field to null", () => {
    assert.equal(riskRulesData({ maxContracts: 3 }).maxContractsBySymbolJson, null);
  });

  it("maps an explicit null to null", () => {
    assert.equal(riskRulesData({ maxContractsBySymbolJson: null }).maxContractsBySymbolJson, null);
  });
});
