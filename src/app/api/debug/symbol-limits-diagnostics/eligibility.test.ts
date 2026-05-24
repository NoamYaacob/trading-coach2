/**
 * Unit tests for the Phase 4E symbol-limits QA eligibility helper.
 *
 * Pure-function tests — no DB, no network. The helper mirrors the three-signal
 * session-traded check used by the real rule-edit lock.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  deriveSymbolLimitsQaEligibility,
  type QaEligibilityInput,
} from "./eligibility.ts";

// connected_readonly, no trades, no token expiry → the eligible baseline.
const BASE: QaEligibilityInput = {
  connectionStatus: "connected_readonly",
  hasAccountRiskRules: true,
  tokenExpired: false,
  currentCmeTradingDayKey: "2026-05-21",
  sessionDate: "2026-05-21",
  tradesCount: 0,
  lastTradeAtIso: null,
  lastTradeAtInCurrentSession: false,
  normalizedTradeEventCountThisSession: 0,
};

describe("deriveSymbolLimitsQaEligibility — eligible", () => {
  it("connected_readonly with no trade signals → canEditRulesNow true", () => {
    const e = deriveSymbolLimitsQaEligibility(BASE);
    assert.equal(e.canEditRulesNow, true);
    assert.equal(e.connectedReadonly, true);
    assert.equal(e.hasTradedThisSession, false);
    assert.equal(e.ruleEditLocked, false);
  });

  it("connected_live with no trade signals → canEditRulesNow true", () => {
    const e = deriveSymbolLimitsQaEligibility({ ...BASE, connectionStatus: "connected_live" });
    assert.equal(e.canEditRulesNow, true);
    assert.equal(e.connectedReadonly, false);
  });

  it("eligible baseline reasons explain the account is ready", () => {
    const e = deriveSymbolLimitsQaEligibility(BASE);
    assert.ok(e.reasons.some((r) => r.includes("eligible for Phase 4E QA")));
  });
});

describe("deriveSymbolLimitsQaEligibility — not eligible", () => {
  it("tradesCount > 0 for the current CME day → canEditRulesNow false", () => {
    const e = deriveSymbolLimitsQaEligibility({ ...BASE, tradesCount: 3 });
    assert.equal(e.hasTradedThisSession, true);
    assert.equal(e.ruleEditLocked, true);
    assert.equal(e.canEditRulesNow, false);
    assert.ok(e.reasons.some((r) => r.includes("traded this CME session")));
  });

  it("tradesCount > 0 but sessionDate stale → signal 1 does not fire alone", () => {
    // Signal 1 requires sessionDate === currentKey; a stale sessionDate means
    // tradesCount alone is not authoritative for the current session.
    const e = deriveSymbolLimitsQaEligibility({
      ...BASE,
      tradesCount: 3,
      sessionDate: "2026-05-20",
    });
    assert.equal(e.hasTradedThisSession, false);
    assert.equal(e.canEditRulesNow, true);
  });

  it("lastTradeAt within the current CME session → canEditRulesNow false", () => {
    const e = deriveSymbolLimitsQaEligibility({
      ...BASE,
      lastTradeAtInCurrentSession: true,
      lastTradeAtIso: "2026-05-21T14:00:00.000Z",
    });
    assert.equal(e.hasTradedThisSession, true);
    assert.equal(e.canEditRulesNow, false);
    assert.ok(e.reasons.some((r) => r.includes("lastTradeAt")));
  });

  it("a NormalizedTradeEvent exists this session → canEditRulesNow false", () => {
    const e = deriveSymbolLimitsQaEligibility({
      ...BASE,
      normalizedTradeEventCountThisSession: 2,
    });
    assert.equal(e.hasTradedThisSession, true);
    assert.equal(e.canEditRulesNow, false);
    assert.ok(e.reasons.some((r) => r.includes("trade event")));
  });

  it("connectionStatus expired → canEditRulesNow false", () => {
    const e = deriveSymbolLimitsQaEligibility({ ...BASE, connectionStatus: "expired" });
    assert.equal(e.canEditRulesNow, false);
    assert.equal(e.connectedReadonly, false);
    assert.ok(e.reasons.some((r) => r.includes("not usable")));
  });

  it("connectionStatus not_connected → canEditRulesNow false", () => {
    const e = deriveSymbolLimitsQaEligibility({ ...BASE, connectionStatus: "not_connected" });
    assert.equal(e.canEditRulesNow, false);
  });

  it("broker token expired → canEditRulesNow false", () => {
    const e = deriveSymbolLimitsQaEligibility({ ...BASE, tokenExpired: true });
    assert.equal(e.canEditRulesNow, false);
    assert.ok(e.reasons.some((r) => r.includes("token is expired")));
  });

  it("tokenExpired null (no expiry stored) does not block eligibility", () => {
    const e = deriveSymbolLimitsQaEligibility({ ...BASE, tokenExpired: null });
    assert.equal(e.canEditRulesNow, true);
  });
});

describe("deriveSymbolLimitsQaEligibility — passthrough fields", () => {
  it("echoes the raw inputs for the diagnostic reader", () => {
    const e = deriveSymbolLimitsQaEligibility({
      ...BASE,
      tradesCount: 5,
      sessionDate: "2026-05-20",
      lastTradeAtIso: "2026-05-20T10:00:00.000Z",
      normalizedTradeEventCountThisSession: 7,
    });
    assert.equal(e.currentCmeTradingDayKey, "2026-05-21");
    assert.equal(e.sessionDate, "2026-05-20");
    assert.equal(e.tradesCount, 5);
    assert.equal(e.lastTradeAt, "2026-05-20T10:00:00.000Z");
    assert.equal(e.normalizedTradeEventCountThisSession, 7);
  });
});
