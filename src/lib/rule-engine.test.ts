/**
 * Unit tests for rule-engine.ts — pure evaluation functions.
 *
 * No DB, no network, no Guardian state required.
 * Run: npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { evaluateRules } from "./rule-engine.ts";
import type { RuleEngineInput } from "./rule-engine.ts";
import { shouldSkipBrokerEnforcement } from "./brokers/enforcement-helpers.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

// 2024-01-08 12:00 UTC = 06:00 CST → Monday in America/Chicago
const MONDAY_UTC = new Date("2024-01-08T12:00:00.000Z");
// 2024-01-10 12:00 UTC → Wednesday in America/Chicago
const WEDNESDAY_UTC = new Date("2024-01-10T12:00:00.000Z");
// 2024-01-12 12:00 UTC → Friday in America/Chicago
const FRIDAY_UTC = new Date("2024-01-12T12:00:00.000Z");
// 2024-01-13 12:00 UTC → Saturday in America/Chicago
const SATURDAY_UTC = new Date("2024-01-13T12:00:00.000Z");

function baseInput(overrides: Partial<RuleEngineInput> = {}): RuleEngineInput {
  return {
    guardianEnabled: true,
    maxTradesPerDay: null,
    todayTradesCount: 0,
    maxDailyLoss: null,
    todayPnL: 0,
    stopAfterConsecutiveLosses: null,
    consecutiveLosses: 0,
    sessionStarted: true,
    sessionEnded: false,
    todaySessionStateKind: "active",
    now: MONDAY_UTC,
    ...overrides,
  };
}

// ── daily_profit_target ───────────────────────────────────────────────────────

describe("daily_profit_target rule", () => {
  it("status=triggered when todayPnL exactly equals the target", () => {
    const results = evaluateRules(baseInput({ dailyProfitTarget: 500, todayPnL: 500 }));
    const rule = results.find((r) => r.ruleId === "daily_profit_target");
    assert.ok(rule, "daily_profit_target rule must be present when target is set");
    assert.equal(rule.status, "triggered");
  });

  it("status=triggered when todayPnL exceeds the target", () => {
    const results = evaluateRules(baseInput({ dailyProfitTarget: 500, todayPnL: 750 }));
    const rule = results.find((r) => r.ruleId === "daily_profit_target")!;
    assert.equal(rule.status, "triggered");
  });

  it("status=warning when todayPnL is within 10% of the target", () => {
    // 90% of 500 = 450 — exactly at the warning threshold
    const results = evaluateRules(baseInput({ dailyProfitTarget: 500, todayPnL: 450 }));
    const rule = results.find((r) => r.ruleId === "daily_profit_target")!;
    assert.equal(rule.status, "warning");
  });

  it("status=ok when todayPnL is below the warning threshold", () => {
    const results = evaluateRules(baseInput({ dailyProfitTarget: 500, todayPnL: 200 }));
    const rule = results.find((r) => r.ruleId === "daily_profit_target")!;
    assert.equal(rule.status, "ok");
  });

  it("status=ok when todayPnL is zero (no trades yet)", () => {
    const results = evaluateRules(baseInput({ dailyProfitTarget: 500, todayPnL: 0 }));
    const rule = results.find((r) => r.ruleId === "daily_profit_target")!;
    assert.equal(rule.status, "ok");
  });

  it("status=ok when todayPnL is negative (losing day)", () => {
    const results = evaluateRules(baseInput({ dailyProfitTarget: 500, todayPnL: -100 }));
    const rule = results.find((r) => r.ruleId === "daily_profit_target")!;
    assert.equal(rule.status, "ok");
  });

  it("triggered result has severity=high", () => {
    const results = evaluateRules(baseInput({ dailyProfitTarget: 500, todayPnL: 600 }));
    const rule = results.find((r) => r.ruleId === "daily_profit_target")!;
    assert.equal(rule.severity, "high");
  });

  it("rule is absent when dailyProfitTarget is null", () => {
    const results = evaluateRules(baseInput({ dailyProfitTarget: null, todayPnL: 999 }));
    const rule = results.find((r) => r.ruleId === "daily_profit_target");
    assert.equal(rule, undefined);
  });

  it("rule is absent when dailyProfitTarget is undefined", () => {
    const results = evaluateRules(baseInput({ todayPnL: 999 }));
    const rule = results.find((r) => r.ruleId === "daily_profit_target");
    assert.equal(rule, undefined);
  });

  it("warning boundary: just below 90% threshold is ok", () => {
    // 89.9% of 500 = 449.5 → below threshold → ok
    const results = evaluateRules(baseInput({ dailyProfitTarget: 500, todayPnL: 449 }));
    const rule = results.find((r) => r.ruleId === "daily_profit_target")!;
    assert.equal(rule.status, "ok");
  });
});

// ── trading_day_disabled rule ─────────────────────────────────────────────────

describe("trading_day_disabled rule", () => {
  it("status=blocked when today is not in tradingDays", () => {
    // MONDAY_UTC → "MON"; tradingDays only has WED/THU/FRI
    const results = evaluateRules(
      baseInput({ tradingDays: ["WED", "THU", "FRI"], now: MONDAY_UTC }),
    );
    const rule = results.find((r) => r.ruleId === "trading_day_disabled");
    assert.ok(rule, "trading_day_disabled rule must be present when tradingDays is set");
    assert.equal(rule.status, "blocked");
  });

  it("status=ok when today IS in tradingDays", () => {
    const results = evaluateRules(
      baseInput({ tradingDays: ["MON", "TUE", "WED", "THU", "FRI"], now: MONDAY_UTC }),
    );
    const rule = results.find((r) => r.ruleId === "trading_day_disabled")!;
    assert.equal(rule.status, "ok");
  });

  it("Saturday is blocked when tradingDays contains only weekdays", () => {
    const results = evaluateRules(
      baseInput({
        tradingDays: ["MON", "TUE", "WED", "THU", "FRI"],
        now: SATURDAY_UTC,
      }),
    );
    const rule = results.find((r) => r.ruleId === "trading_day_disabled")!;
    assert.equal(rule.status, "blocked");
  });

  it("Wednesday is allowed when tradingDays includes WED", () => {
    const results = evaluateRules(
      baseInput({ tradingDays: ["MON", "WED", "FRI"], now: WEDNESDAY_UTC }),
    );
    const rule = results.find((r) => r.ruleId === "trading_day_disabled")!;
    assert.equal(rule.status, "ok");
  });

  it("Friday is allowed in a full 5-day schedule", () => {
    const results = evaluateRules(
      baseInput({ tradingDays: ["MON", "TUE", "WED", "THU", "FRI"], now: FRIDAY_UTC }),
    );
    const rule = results.find((r) => r.ruleId === "trading_day_disabled")!;
    assert.equal(rule.status, "ok");
  });

  it("rule is absent when tradingDays is null", () => {
    const results = evaluateRules(baseInput({ tradingDays: null, now: SATURDAY_UTC }));
    const rule = results.find((r) => r.ruleId === "trading_day_disabled");
    assert.equal(rule, undefined);
  });

  it("rule is absent when tradingDays is undefined", () => {
    const results = evaluateRules(baseInput({ now: SATURDAY_UTC }));
    const rule = results.find((r) => r.ruleId === "trading_day_disabled");
    assert.equal(rule, undefined);
  });

  it("rule is absent when tradingDays is an empty array", () => {
    const results = evaluateRules(baseInput({ tradingDays: [], now: SATURDAY_UTC }));
    const rule = results.find((r) => r.ruleId === "trading_day_disabled");
    assert.equal(rule, undefined);
  });

  it("blocked result has severity=high", () => {
    const results = evaluateRules(
      baseInput({ tradingDays: ["WED", "THU", "FRI"], now: MONDAY_UTC }),
    );
    const rule = results.find((r) => r.ruleId === "trading_day_disabled")!;
    assert.equal(rule.severity, "high");
  });

  it("reason string contains the current day code", () => {
    const results = evaluateRules(
      baseInput({ tradingDays: ["WED"], now: MONDAY_UTC }),
    );
    const rule = results.find((r) => r.ruleId === "trading_day_disabled")!;
    assert.ok(rule.reason.includes("MON"), `reason must mention the current day, got: ${rule.reason}`);
  });
});

// ── shouldSkipBrokerEnforcement — new trigger types ───────────────────────────

describe("shouldSkipBrokerEnforcement — profit_target trigger", () => {
  it("profit_target on connected_live Tradovate → skip=true, monitoring_only", () => {
    const result = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "profit_target",
      connectionStatus: "connected_live",
    });
    assert.equal(result.skip, true);
    if (result.skip) assert.equal(result.lockStatus, "monitoring_only");
  });

  it("profit_target on read-only Tradovate → skip=true, monitoring_only (not unavailable_read_only)", () => {
    // The read-only check comes after the trigger check, so profit_target
    // always gets monitoring_only regardless of connection status.
    const result = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "profit_target",
      connectionStatus: "connected_readonly",
    });
    assert.equal(result.skip, true);
    if (result.skip) assert.equal(result.lockStatus, "monitoring_only");
  });

  it("profit_target is never broker-enforced — no Tradovate API field for profit targets", () => {
    const result = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "profit_target",
      connectionStatus: "connected_live",
    });
    assert.equal(result.skip, true, "profit_target must always skip broker enforcement");
  });
});

describe("shouldSkipBrokerEnforcement — trading_day_disabled trigger", () => {
  it("trading_day_disabled on connected_live Tradovate → skip=true, monitoring_only", () => {
    const result = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "trading_day_disabled",
      connectionStatus: "connected_live",
    });
    assert.equal(result.skip, true);
    if (result.skip) assert.equal(result.lockStatus, "monitoring_only");
  });

  it("trading_day_disabled on non-Tradovate platform → skip=true, monitoring_only", () => {
    const result = shouldSkipBrokerEnforcement({
      platform: "ninja_trader",
      trigger: "trading_day_disabled",
      connectionStatus: "connected_live",
    });
    assert.equal(result.skip, true);
    if (result.skip) assert.equal(result.lockStatus, "monitoring_only");
  });

  it("trading_day_disabled is never broker-enforced — no Tradovate API field for day restrictions", () => {
    const result = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "trading_day_disabled",
      connectionStatus: "connected_live",
    });
    assert.equal(result.skip, true, "trading_day_disabled must always skip broker enforcement");
  });
});
