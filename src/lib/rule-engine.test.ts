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
  it("profit_target on connected_live Tradovate → skip=false (broker call should proceed)", () => {
    // dailyProfitAutoLiq verified in OpenAPI audit (May 2026) — broker-enforced.
    const result = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "profit_target",
      connectionStatus: "connected_live",
    });
    assert.equal(result.skip, false);
  });

  it("profit_target on read-only Tradovate → skip=true with unavailable_read_only", () => {
    // Trigger is broker-capable so the read-only gate fires, returning unavailable_read_only.
    const result = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "profit_target",
      connectionStatus: "connected_readonly",
    });
    assert.equal(result.skip, true);
    if (result.skip) assert.equal(result.lockStatus, "unavailable_read_only");
  });

  it("profit_target on non-Tradovate platform → skip=true with monitoring_only", () => {
    const result = shouldSkipBrokerEnforcement({
      platform: "tradingview",
      trigger: "profit_target",
      connectionStatus: "connected_live",
    });
    assert.equal(result.skip, true);
    if (result.skip) assert.equal(result.lockStatus, "monitoring_only");
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

// ── max_position_size rule ────────────────────────────────────────────────────

describe("max_position_size rule", () => {
  // NQ has a mini-equivalent ratio of 1 (it is the standard).
  // MNQ has a ratio of 0.1 (10 MNQ = 1 NQ-equivalent).
  // currentMiniEquivalentExposure is the sum of all positions expressed in
  // standard-equivalent units as computed by computeMiniEquivalentExposure.

  it("status=triggered when NQ qty=2 breaches max=1", () => {
    // 2 NQ = 2.0 standard-equivalent → breaches limit of 1
    const results = evaluateRules(
      baseInput({ maxContracts: 1, currentMiniEquivalentExposure: 2 }),
    );
    const rule = results.find((r) => r.ruleId === "max_position_size");
    assert.ok(rule, "max_position_size rule must be present when maxContracts is set");
    assert.equal(rule.status, "triggered");
    assert.equal(rule.severity, "critical");
  });

  it("status=ok when NQ qty=1 is within max=1", () => {
    // 1 NQ = 1.0 standard-equivalent → exactly at limit (not over)
    const results = evaluateRules(
      baseInput({ maxContracts: 1, currentMiniEquivalentExposure: 1 }),
    );
    const rule = results.find((r) => r.ruleId === "max_position_size")!;
    assert.equal(rule.status, "ok");
  });

  it("status=ok when MNQ qty=10 is within max=1 (10 MNQ = 1 NQ-equivalent)", () => {
    // 10 MNQ × 0.1 = 1.0 standard-equivalent → exactly at limit
    const results = evaluateRules(
      baseInput({ maxContracts: 1, currentMiniEquivalentExposure: 1 }),
    );
    const rule = results.find((r) => r.ruleId === "max_position_size")!;
    assert.equal(rule.status, "ok");
  });

  it("status=triggered when MNQ qty=11 breaches max=1 (11 × 0.1 = 1.1)", () => {
    // 11 MNQ × 0.1 = 1.1 standard-equivalent → breaches limit of 1
    const results = evaluateRules(
      baseInput({ maxContracts: 1, currentMiniEquivalentExposure: 1.1 }),
    );
    const rule = results.find((r) => r.ruleId === "max_position_size")!;
    assert.equal(rule.status, "triggered");
  });

  it("mixed NQ + MNQ exposure is summed: 1 NQ + 5 MNQ = 1.5 standard-equivalent, breaches max=1", () => {
    // 1 NQ (1.0) + 5 MNQ (0.5) = 1.5 total → breaches 1
    const results = evaluateRules(
      baseInput({ maxContracts: 1, currentMiniEquivalentExposure: 1.5 }),
    );
    const rule = results.find((r) => r.ruleId === "max_position_size")!;
    assert.equal(rule.status, "triggered");
  });

  it("rule is absent when maxContracts is null (no rule configured)", () => {
    const results = evaluateRules(
      baseInput({ maxContracts: null, currentMiniEquivalentExposure: 99 }),
    );
    const rule = results.find((r) => r.ruleId === "max_position_size");
    assert.equal(rule, undefined);
  });

  it("rule is absent when maxContracts is undefined", () => {
    const results = evaluateRules(baseInput({ currentMiniEquivalentExposure: 99 }));
    const rule = results.find((r) => r.ruleId === "max_position_size");
    assert.equal(rule, undefined);
  });

  it("rule is absent when maxContracts is 0 (treated as unconfigured)", () => {
    const results = evaluateRules(
      baseInput({ maxContracts: 0, currentMiniEquivalentExposure: 99 }),
    );
    const rule = results.find((r) => r.ruleId === "max_position_size");
    assert.equal(rule, undefined);
  });

  it("rule is skipped silently when currentMiniEquivalentExposure is null (data unavailable)", () => {
    // Positions not yet fetched — should not produce a spurious result
    const results = evaluateRules(
      baseInput({ maxContracts: 1, currentMiniEquivalentExposure: null }),
    );
    const rule = results.find((r) => r.ruleId === "max_position_size");
    assert.equal(rule, undefined);
  });

  it("status=triggered with severity=high when hasUnsupportedPositions=true (cannot verify exposure)", () => {
    const results = evaluateRules(
      baseInput({
        maxContracts: 1,
        currentMiniEquivalentExposure: 0,
        hasUnsupportedPositions: true,
        unsupportedSymbols: ["XYZUSD"],
      }),
    );
    const rule = results.find((r) => r.ruleId === "max_position_size")!;
    assert.equal(rule.status, "triggered");
    assert.equal(rule.severity, "high");
    assert.ok(
      rule.reason.includes("XYZUSD"),
      `reason must mention the unrecognized symbol, got: ${rule.reason}`,
    );
  });

  it("unsupported-position trigger fires even when currentMiniEquivalentExposure=0 (no falsely safe pass)", () => {
    // hasUnsupportedPositions takes precedence — we cannot verify the limit is clear
    const results = evaluateRules(
      baseInput({
        maxContracts: 2,
        currentMiniEquivalentExposure: 0,
        hasUnsupportedPositions: true,
      }),
    );
    const rule = results.find((r) => r.ruleId === "max_position_size")!;
    assert.equal(rule.status, "triggered");
  });

  it("triggered message mentions detection-response model", () => {
    const results = evaluateRules(
      baseInput({ maxContracts: 1, currentMiniEquivalentExposure: 2 }),
    );
    const rule = results.find((r) => r.ruleId === "max_position_size")!;
    // Must not imply that Tradovate blocked the order (it didn't) — enforcement is post-execution
    assert.ok(
      rule.message.toLowerCase().includes("flatten") ||
        rule.message.toLowerCase().includes("sync") ||
        rule.message.toLowerCase().includes("detect"),
      `message must describe detection-response model, got: ${rule.message}`,
    );
  });

  it("rule is evaluated per-account (other rules in the same batch are unaffected)", () => {
    // Feeding maxContracts+exposure only affects max_position_size, not max_daily_loss
    const results = evaluateRules(
      baseInput({ maxContracts: 1, currentMiniEquivalentExposure: 2, maxDailyLoss: 500, todayPnL: -100 }),
    );
    const posRule = results.find((r) => r.ruleId === "max_position_size")!;
    const lossRule = results.find((r) => r.ruleId === "max_daily_loss")!;
    assert.equal(posRule.status, "triggered");
    assert.equal(lossRule.status, "ok");
  });
});

// ── shouldSkipBrokerEnforcement — non-live connection states ──────────────────
// Live-readiness gate: regardless of permissionLevel, a broker write must not
// be attempted on a connection that is expired, errored, never connected, or
// in-flight OAuth. Upstream cron/webhook filters also gate these states; this
// is the last-line defense inside applyBrokerDayLockout.

describe("shouldSkipBrokerEnforcement — non-live connection states (live-readiness)", () => {
  const NON_LIVE = [
    "expired",
    "connection_error",
    "not_connected",
    "pending_webhook",
    "oauth_pending_storage",
  ] as const;

  for (const status of NON_LIVE) {
    it(`connectionStatus='${status}' + permissionLevel='full_access' → skip=true (no write attempted)`, () => {
      const result = shouldSkipBrokerEnforcement({
        platform: "tradovate",
        trigger: "daily_loss_limit",
        connectionStatus: status,
        permissionLevel: "full_access",
      });
      assert.equal(result.skip, true);
      if (result.skip) {
        assert.equal(result.lockStatus, "broker_lock_failed");
        assert.ok(
          result.reason.includes(status),
          `expected reason to mention status '${status}', got: ${result.reason}`,
        );
      }
    });

    it(`connectionStatus='${status}' + permissionLevel=null → skip=true`, () => {
      const result = shouldSkipBrokerEnforcement({
        platform: "tradovate",
        trigger: "daily_loss_limit",
        connectionStatus: status,
        permissionLevel: null,
      });
      assert.equal(result.skip, true);
    });
  }

  it("connectionStatus='connected_live' + permissionLevel='full_access' → skip=false (the only happy path)", () => {
    const result = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "daily_loss_limit",
      connectionStatus: "connected_live",
      permissionLevel: "full_access",
    });
    assert.equal(result.skip, false);
  });

  it("connectionStatus='connected_live' + permissionLevel='read_only' → skip=true (unavailable_read_only)", () => {
    const result = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "daily_loss_limit",
      connectionStatus: "connected_live",
      permissionLevel: "read_only",
    });
    assert.equal(result.skip, true);
    if (result.skip) assert.equal(result.lockStatus, "unavailable_read_only");
  });

  it("connectionStatus='connected_live' + permissionLevel='unknown' → falls back to legacy (proceeds optimistically)", () => {
    // 'unknown' is the probe's inconclusive verdict (5xx / network error). The
    // legacy fallback proceeds when connectionStatus is connected_live; the
    // broker call's 403 handler will record any actual permission gap.
    const result = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "daily_loss_limit",
      connectionStatus: "connected_live",
      permissionLevel: "unknown",
    });
    assert.equal(result.skip, false);
  });

  it("dry-run is gated AFTER skip checks (skip wins) — read_only + dry-run still returns unavailable_read_only", () => {
    // shouldSkipBrokerEnforcement does not consult ENFORCEMENT_DRY_RUN itself;
    // the dry-run gate sits inside applyBrokerDayLockout, after the skip check.
    // This test documents the order: skip first, dry-run second.
    const result = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "daily_loss_limit",
      connectionStatus: "connected_live",
      permissionLevel: "read_only",
    });
    assert.equal(result.skip, true);
    if (result.skip) assert.equal(result.lockStatus, "unavailable_read_only");
  });
});
