import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  RULE_CAPABILITIES,
  getRuleCapability,
  isBrokerEligible,
  isInternalLockEligible,
} from "./rule-capabilities.ts";

describe("RULE_CAPABILITIES — structure invariants", () => {
  it("is a non-empty array", () => {
    assert.ok(Array.isArray(RULE_CAPABILITIES), "expected RULE_CAPABILITIES to be an array");
    assert.ok(RULE_CAPABILITIES.length > 0, "expected at least one rule capability");
  });

  it("maxDailyLoss has brokerRiskSettingsEligible=true", () => {
    const cap = RULE_CAPABILITIES.find((r) => r.ruleKey === "maxDailyLoss");
    assert.ok(cap, "maxDailyLoss must be in RULE_CAPABILITIES");
    assert.equal(cap.brokerRiskSettingsEligible, true);
  });

  it("dailyProfitTarget has brokerRiskSettingsEligible=false", () => {
    const cap = RULE_CAPABILITIES.find((r) => r.ruleKey === "dailyProfitTarget");
    assert.ok(cap, "dailyProfitTarget must be in RULE_CAPABILITIES");
    assert.equal(cap.brokerRiskSettingsEligible, false);
  });

  it("maxTradesPerDay has brokerRiskSettingsEligible=false", () => {
    const cap = RULE_CAPABILITIES.find((r) => r.ruleKey === "maxTradesPerDay");
    assert.ok(cap, "maxTradesPerDay must be in RULE_CAPABILITIES");
    assert.equal(cap.brokerRiskSettingsEligible, false);
  });

  it("stopAfterLosses has brokerRiskSettingsEligible=false", () => {
    const cap = RULE_CAPABILITIES.find((r) => r.ruleKey === "stopAfterLosses");
    assert.ok(cap, "stopAfterLosses must be in RULE_CAPABILITIES");
    assert.equal(cap.brokerRiskSettingsEligible, false);
  });

  it("maxContracts has brokerRiskSettingsEligible=false", () => {
    const cap = RULE_CAPABILITIES.find((r) => r.ruleKey === "maxContracts");
    assert.ok(cap, "maxContracts must be in RULE_CAPABILITIES");
    assert.equal(cap.brokerRiskSettingsEligible, false);
  });

  it("no rule other than maxDailyLoss has brokerRiskSettingsEligible=true (SAFETY INVARIANT)", () => {
    const brokerEligible = RULE_CAPABILITIES.filter(
      (r) => r.brokerRiskSettingsEligible === true && r.ruleKey !== "maxDailyLoss",
    );
    assert.equal(
      brokerEligible.length,
      0,
      `expected only maxDailyLoss to be broker-eligible, but found: ${brokerEligible.map((r) => r.ruleKey).join(", ")}`,
    );
  });

  it("no rule has orderActionEligible=true (Phase 3 not started)", () => {
    const orderActionRules = RULE_CAPABILITIES.filter((r) => r.orderActionEligible === true);
    assert.equal(
      orderActionRules.length,
      0,
      `expected no orderActionEligible rules, but found: ${orderActionRules.map((r) => r.ruleKey).join(", ")}`,
    );
  });

  it("editableAfterBreach is false for all rules", () => {
    const breachEditable = RULE_CAPABILITIES.filter((r) => r.editableAfterBreach === true);
    assert.equal(
      breachEditable.length,
      0,
      `expected editableAfterBreach=false for all rules, but found: ${breachEditable.map((r) => r.ruleKey).join(", ")}`,
    );
  });
});

describe("getRuleCapability — lookup helper", () => {
  it("returns null for unknown key", () => {
    assert.equal(getRuleCapability("unknownRule_xyz"), null);
  });

  it("returns null for empty string", () => {
    assert.equal(getRuleCapability(""), null);
  });

  it("returns capability for known key", () => {
    const cap = getRuleCapability("maxDailyLoss");
    assert.ok(cap !== null, "expected a result for maxDailyLoss");
    assert.equal(cap.ruleKey, "maxDailyLoss");
  });
});

describe("isBrokerEligible — helper", () => {
  it("returns true for maxDailyLoss", () => {
    assert.equal(isBrokerEligible("maxDailyLoss"), true);
  });

  it("returns false for dailyProfitTarget", () => {
    assert.equal(isBrokerEligible("dailyProfitTarget"), false);
  });

  it("returns false for maxTradesPerDay", () => {
    assert.equal(isBrokerEligible("maxTradesPerDay"), false);
  });

  it("returns false for stopAfterLosses", () => {
    assert.equal(isBrokerEligible("stopAfterLosses"), false);
  });

  it("returns false for maxContracts", () => {
    assert.equal(isBrokerEligible("maxContracts"), false);
  });

  it("returns false for unknown key", () => {
    assert.equal(isBrokerEligible("notARealRule"), false);
  });
});

describe("isInternalLockEligible — helper", () => {
  it("returns true for maxDailyLoss", () => {
    assert.equal(isInternalLockEligible("maxDailyLoss"), true);
  });

  it("returns true for maxTradesPerDay", () => {
    assert.equal(isInternalLockEligible("maxTradesPerDay"), true);
  });

  it("returns true for stopAfterLosses", () => {
    assert.equal(isInternalLockEligible("stopAfterLosses"), true);
  });

  it("returns false for dailyProfitTarget", () => {
    assert.equal(isInternalLockEligible("dailyProfitTarget"), false);
  });

  it("returns false for maxContracts", () => {
    assert.equal(isInternalLockEligible("maxContracts"), false);
  });

  it("returns false for unknown key", () => {
    assert.equal(isInternalLockEligible("notARealRule"), false);
  });
});
