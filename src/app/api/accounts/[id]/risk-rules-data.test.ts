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
