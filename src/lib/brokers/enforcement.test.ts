/**
 * Unit tests for broker enforcement helpers.
 *
 * Tests cover only pure functions — no network calls, no database,
 * no TradovateClient instantiation required.
 *
 * Run: npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildAutoLiqUpdatePayload,
  buildAutoLiqCreatePayload,
  buildAutoLiqProfitUpdatePayload,
  buildAutoLiqProfitCreatePayload,
  computeLossAmountToSet,
  computeProfitAmountToSet,
  shouldSkipBrokerEnforcement,
  classifyEnforcementError,
  isAutoLiqConfirmed,
} from "./enforcement-helpers.ts";
import type { EnforcementTrigger } from "./enforcement-helpers.ts";

// ── buildAutoLiqUpdatePayload ─────────────────────────────────────────────────

describe("buildAutoLiqUpdatePayload", () => {
  it("includes id, dailyLossAutoLiq, and changesLocked=true by default", () => {
    const payload = buildAutoLiqUpdatePayload({ existingId: 42, dailyLossAutoLiq: 250 });
    assert.equal(payload.id, 42);
    assert.equal(payload.dailyLossAutoLiq, 250);
    assert.equal(payload.changesLocked, true);
  });

  it("does NOT include doNotUnlock — auto-unlock at next session open must be preserved", () => {
    const payload = buildAutoLiqUpdatePayload({ existingId: 99, dailyLossAutoLiq: 100 });
    assert.ok(
      !("doNotUnlock" in payload),
      "doNotUnlock must be absent — setting it would permanently trap the account",
    );
  });

  it("changesLocked can be explicitly overridden to false", () => {
    const payload = buildAutoLiqUpdatePayload({
      existingId: 1,
      dailyLossAutoLiq: 50,
      changesLocked: false,
    });
    assert.equal(payload.changesLocked, false);
  });

  it("is generic — uses the provided existingId, not any hardcoded value", () => {
    const p1 = buildAutoLiqUpdatePayload({ existingId: 111, dailyLossAutoLiq: 100 });
    const p2 = buildAutoLiqUpdatePayload({ existingId: 222, dailyLossAutoLiq: 100 });
    assert.equal(p1.id, 111);
    assert.equal(p2.id, 222);
    assert.notEqual(p1.id, p2.id);
  });

  it("preserves exact dollar amount in dailyLossAutoLiq", () => {
    const payload = buildAutoLiqUpdatePayload({ existingId: 1, dailyLossAutoLiq: 347.82 });
    assert.equal(payload.dailyLossAutoLiq, 347.82);
  });

  it("payload contains exactly the expected keys", () => {
    const payload = buildAutoLiqUpdatePayload({ existingId: 5, dailyLossAutoLiq: 200 });
    const keys = Object.keys(payload).sort();
    assert.deepEqual(keys, ["changesLocked", "dailyLossAutoLiq", "id"]);
  });
});

// ── buildAutoLiqCreatePayload ─────────────────────────────────────────────────

describe("buildAutoLiqCreatePayload", () => {
  it("includes accountId, dailyLossAutoLiq, and changesLocked=true by default", () => {
    const payload = buildAutoLiqCreatePayload({ tvAccountId: 6248, dailyLossAutoLiq: 300 });
    assert.equal(payload.accountId, 6248);
    assert.equal(payload.dailyLossAutoLiq, 300);
    assert.equal(payload.changesLocked, true);
  });

  it("does NOT include doNotUnlock", () => {
    const payload = buildAutoLiqCreatePayload({ tvAccountId: 6248, dailyLossAutoLiq: 100 });
    assert.ok(
      !("doNotUnlock" in payload),
      "doNotUnlock must be absent from the create payload",
    );
  });

  it("is generic — uses the provided tvAccountId, not any hardcoded account", () => {
    const p1 = buildAutoLiqCreatePayload({ tvAccountId: 1001, dailyLossAutoLiq: 50 });
    const p2 = buildAutoLiqCreatePayload({ tvAccountId: 9999, dailyLossAutoLiq: 50 });
    assert.equal(p1.accountId, 1001);
    assert.equal(p2.accountId, 9999);
    assert.notEqual(p1.accountId, p2.accountId);
  });

  it("payload contains exactly the expected keys", () => {
    const payload = buildAutoLiqCreatePayload({ tvAccountId: 6248, dailyLossAutoLiq: 200 });
    const keys = Object.keys(payload).sort();
    assert.deepEqual(keys, ["accountId", "changesLocked", "dailyLossAutoLiq"]);
  });

  it("any Tradovate account ID is accepted — no firm-specific logic", () => {
    // Regression guard: function must not contain hardcoded firm IDs.
    const ids = [6248, 99999, 123456789];
    for (const id of ids) {
      const payload = buildAutoLiqCreatePayload({ tvAccountId: id, dailyLossAutoLiq: 100 });
      assert.equal(payload.accountId, id, `expected accountId=${id}`);
    }
  });
});

// ── computeLossAmountToSet ────────────────────────────────────────────────────

describe("computeLossAmountToSet", () => {
  it("returns absolute value of a negative daily P&L", () => {
    assert.equal(computeLossAmountToSet(-250), 250);
  });

  it("accepts a positive value (already-absolute loss) unchanged", () => {
    // Callers pre-compute Math.abs(Math.min(dailyPnl, 0)), so currentDailyLoss
    // is always non-negative. A positive input is a loss amount, not a profit.
    assert.equal(computeLossAmountToSet(250), 250);
  });

  it("returns 0 for exactly zero (break-even or no-loss day)", () => {
    assert.equal(computeLossAmountToSet(0), 0);
  });

  it("returns 0 for null", () => {
    assert.equal(computeLossAmountToSet(null), 0);
  });

  it("returns 0 for undefined", () => {
    assert.equal(computeLossAmountToSet(undefined), 0);
  });

  it("returns 0 for NaN", () => {
    assert.equal(computeLossAmountToSet(NaN), 0);
  });

  it("uses account-specific loss — different amounts produce different thresholds", () => {
    // Account A lost $500, Account B lost $250 — thresholds must differ
    const a = computeLossAmountToSet(-500);
    const b = computeLossAmountToSet(-250);
    assert.equal(a, 500);
    assert.equal(b, 250);
    assert.notEqual(a, b);
  });

  it("preserves cent-level precision", () => {
    assert.equal(computeLossAmountToSet(-347.82), 347.82);
  });
});

// ── shouldSkipBrokerEnforcement ───────────────────────────────────────────────

describe("shouldSkipBrokerEnforcement", () => {
  it("returns skip=false for Tradovate + daily_loss_limit + connected_live", () => {
    const result = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "daily_loss_limit",
      connectionStatus: "connected_live",
    });
    assert.equal(result.skip, false);
  });

  it("read-only connection → skip=true with unavailable_read_only", () => {
    const result = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "daily_loss_limit",
      connectionStatus: "connected_readonly",
    });
    assert.equal(result.skip, true);
    if (result.skip) assert.equal(result.lockStatus, "unavailable_read_only");
  });

  it("read-only connection NEVER reaches the broker API — no 401 can expire the connection", () => {
    // When skip=true the API is never called, so no 401/403 can reach
    // TradovateClient.#markConnectionExpired.
    const result = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "daily_loss_limit",
      connectionStatus: "connected_readonly",
    });
    assert.equal(result.skip, true, "read-only must always skip");
  });

  it("non-Tradovate platform → skip=true with monitoring_only", () => {
    const result = shouldSkipBrokerEnforcement({
      platform: "tradingview",
      trigger: "daily_loss_limit",
      connectionStatus: "connected_live",
    });
    assert.equal(result.skip, true);
    if (result.skip) assert.equal(result.lockStatus, "monitoring_only");
  });

  it("trade_limit trigger → skip=true with monitoring_only", () => {
    const result = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "trade_limit",
      connectionStatus: "connected_live",
    });
    assert.equal(result.skip, true);
    if (result.skip) assert.equal(result.lockStatus, "monitoring_only");
  });

  it("consecutive_losses trigger → skip=true with monitoring_only", () => {
    const result = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "consecutive_losses",
      connectionStatus: "connected_live",
    });
    assert.equal(result.skip, true);
    if (result.skip) assert.equal(result.lockStatus, "monitoring_only");
  });

  it("manual trigger → skip=true with monitoring_only", () => {
    const result = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "manual",
      connectionStatus: "connected_live",
    });
    assert.equal(result.skip, true);
    if (result.skip) assert.equal(result.lockStatus, "monitoring_only");
  });

  it("is generic — any account on any supported firm uses the same logic", () => {
    // No prop-firm names or account IDs are referenced inside the function.
    const inputs = [
      { platform: "tradovate", trigger: "daily_loss_limit" as const, connectionStatus: "connected_live" },
      { platform: "tradovate", trigger: "daily_loss_limit" as const, connectionStatus: "connected_live" },
    ];
    for (const input of inputs) {
      const r = shouldSkipBrokerEnforcement(input);
      assert.equal(r.skip, false, "connected_live daily_loss_limit must never skip");
    }
  });
});

// ── classifyEnforcementError ──────────────────────────────────────────────────

describe("classifyEnforcementError", () => {
  it("HTTP 403 → unavailable_permission (missing Account Risk Settings write)", () => {
    const { lockStatus } = classifyEnforcementError({
      statusCode: 403,
      code: "API_ERROR",
      message: "Forbidden",
    });
    assert.equal(lockStatus, "unavailable_permission");
  });

  it("HTTP 403 is NOT monitoring_only — it's a distinct permission failure", () => {
    const { lockStatus } = classifyEnforcementError({ statusCode: 403 });
    assert.notEqual(lockStatus, "monitoring_only");
  });

  it("HTTP 403 is NOT broker_lock_failed — it's a capability gap, not a transient error", () => {
    const { lockStatus } = classifyEnforcementError({ statusCode: 403 });
    assert.notEqual(lockStatus, "broker_lock_failed");
  });

  it("HTTP 401 → broker_lock_failed (token rejected for this call)", () => {
    const { lockStatus } = classifyEnforcementError({
      statusCode: 401,
      code: "API_ERROR",
      message: "Unauthorized",
    });
    assert.equal(lockStatus, "broker_lock_failed");
  });

  it("NO_ACCOUNT_ID → broker_lock_failed", () => {
    const { lockStatus } = classifyEnforcementError({
      code: "NO_ACCOUNT_ID",
      message: "account id not resolved",
    });
    assert.equal(lockStatus, "broker_lock_failed");
  });

  it("NETWORK_ERROR → broker_lock_failed", () => {
    const { lockStatus } = classifyEnforcementError({
      code: "NETWORK_ERROR",
      message: "fetch failed",
    });
    assert.equal(lockStatus, "broker_lock_failed");
  });

  it("unknown error → broker_lock_failed", () => {
    const { lockStatus } = classifyEnforcementError(new Error("something unexpected"));
    assert.equal(lockStatus, "broker_lock_failed");
  });

  it("403 failure reason mentions Account Risk Settings permission", () => {
    const { failureReason } = classifyEnforcementError({ statusCode: 403 });
    assert.ok(
      failureReason.toLowerCase().includes("account risk settings"),
      `expected 'Account Risk Settings' in reason, got: ${failureReason}`,
    );
  });
});

// ── isAutoLiqConfirmed ────────────────────────────────────────────────────────

describe("isAutoLiqConfirmed", () => {
  it("returns true when response value exactly matches expected", () => {
    assert.equal(isAutoLiqConfirmed({ expectedValue: 250, responseValue: 250 }), true);
  });

  it("returns true within the default 1-cent epsilon", () => {
    assert.equal(isAutoLiqConfirmed({ expectedValue: 250, responseValue: 250.005 }), true);
  });

  it("returns false when response value differs by more than epsilon", () => {
    assert.equal(isAutoLiqConfirmed({ expectedValue: 250, responseValue: 251 }), false);
  });

  it("returns false when responseValue is null (field absent from response)", () => {
    assert.equal(isAutoLiqConfirmed({ expectedValue: 250, responseValue: null }), false);
  });

  it("returns false when responseValue is undefined", () => {
    assert.equal(isAutoLiqConfirmed({ expectedValue: 250, responseValue: undefined }), false);
  });

  it("returns false when responseValue is NaN", () => {
    assert.equal(isAutoLiqConfirmed({ expectedValue: 250, responseValue: NaN }), false);
  });

  it("respects a custom epsilon", () => {
    assert.equal(isAutoLiqConfirmed({ expectedValue: 250, responseValue: 250.5, epsilon: 1 }), true);
    assert.equal(isAutoLiqConfirmed({ expectedValue: 250, responseValue: 250.5, epsilon: 0.1 }), false);
  });

  it("confirmed=true is required before UI shows broker_locked — null response is not confirmed", () => {
    // Regression guard: broker_locked must never be set when response field is absent.
    // The caller (enforcement.ts) must use confirmed=false → broker_lock_failed.
    const unconfirmed = isAutoLiqConfirmed({ expectedValue: 500, responseValue: null });
    assert.equal(unconfirmed, false, "absent responseValue must not confirm the lock");
  });
});

// ── skipMarkExpired contract ──────────────────────────────────────────────────

describe("skipMarkExpired contract for risk endpoints", () => {
  // Document the expected behaviour: 401/403 from userAccountAutoLiq endpoints
  // must not expire the whole OAuth connection.
  //
  // The actual skipMarkExpired=true flag is set in TradovateClient.#request()
  // (getUserAccountAutoLiq and applyDailyLossLock). These tests verify the
  // helper-layer reasoning that supports that decision.

  it("read-only connection returns skip=true — API never called, no expiry possible", () => {
    const result = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "daily_loss_limit",
      connectionStatus: "connected_readonly",
    });
    assert.equal(result.skip, true);
  });

  it("403 maps to unavailable_permission, not broker_lock_failed — preserving the connection distinction", () => {
    // Permission gap on the risk endpoint != globally broken credentials.
    // The connection remains usable for read-only endpoints.
    const { lockStatus } = classifyEnforcementError({ statusCode: 403 });
    assert.equal(lockStatus, "unavailable_permission");
    assert.notEqual(lockStatus, "broker_lock_failed");
  });

  it("doNotUnlock is absent from both update and create payloads", () => {
    const update = buildAutoLiqUpdatePayload({ existingId: 1, dailyLossAutoLiq: 100 });
    const create = buildAutoLiqCreatePayload({ tvAccountId: 1, dailyLossAutoLiq: 100 });
    assert.ok(!("doNotUnlock" in update), "update payload must not set doNotUnlock");
    assert.ok(!("doNotUnlock" in create), "create payload must not set doNotUnlock");
  });
});

// ── shouldSkipBrokerEnforcement — broker day-lockout trigger coverage ─────────

describe("shouldSkipBrokerEnforcement — consecutive_losses trigger", () => {
  it("consecutive_losses → skip=true with monitoring_only (no Tradovate field for loss streaks)", () => {
    const result = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "consecutive_losses",
      connectionStatus: "connected_live",
    });
    assert.equal(result.skip, true);
    if (result.skip) assert.equal(result.lockStatus, "monitoring_only");
  });

  it("consecutive_losses on read-only → monitoring_only, NOT unavailable_read_only (trigger gate fires first)", () => {
    // The trigger check (not daily_loss_limit/profit_target) fires before the
    // connection-status check, so read-only returns monitoring_only, not unavailable_read_only.
    const result = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "consecutive_losses",
      connectionStatus: "connected_readonly",
    });
    assert.equal(result.skip, true);
    if (result.skip) assert.equal(result.lockStatus, "monitoring_only");
  });
});

describe("shouldSkipBrokerEnforcement — all verified rule-breach triggers", () => {
  // daily_loss_limit and profit_target can be broker-enforced via userAccountAutoLiq.
  // All other triggers must return skip=true / monitoring_only.
  const NON_BROKER_TRIGGERS: EnforcementTrigger[] = [
    "trade_limit",
    "consecutive_losses",
    "trading_day_disabled",
    "session_end",
    "manual",
  ];

  it("daily_loss_limit on connected_live Tradovate → skip=false (broker call should proceed)", () => {
    const result = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "daily_loss_limit",
      connectionStatus: "connected_live",
    });
    assert.equal(result.skip, false);
  });

  it("profit_target on connected_live Tradovate → skip=false (broker call should proceed)", () => {
    const result = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "profit_target",
      connectionStatus: "connected_live",
    });
    assert.equal(result.skip, false);
  });

  for (const trigger of NON_BROKER_TRIGGERS) {
    it(`${trigger} on connected_live Tradovate → skip=true, monitoring_only`, () => {
      const result = shouldSkipBrokerEnforcement({
        platform: "tradovate",
        trigger,
        connectionStatus: "connected_live",
      });
      assert.equal(result.skip, true, `${trigger} must skip broker enforcement`);
      if (result.skip) {
        assert.equal(result.lockStatus, "monitoring_only", `${trigger} must return monitoring_only`);
      }
    });
  }

  it("estimated trade count: trade_limit is monitoring_only — sync enforces this at the caller level", () => {
    // The sync layer (tradovate-sync.ts) guards trade_limit with
    // tradeCountIsAuthoritative before calling triggerEnforcement. This test
    // documents that shouldSkipBrokerEnforcement independently returns
    // monitoring_only for trade_limit regardless of any caller-side guard.
    const result = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "trade_limit",
      connectionStatus: "connected_live",
    });
    assert.equal(result.skip, true);
    if (result.skip) assert.equal(result.lockStatus, "monitoring_only");
  });
});

describe("broker_locked requires read-back confirmation — applyBrokerDayLockout contract", () => {
  // These tests verify the pure-function building blocks that enforce
  // the read-back confirmation requirement before broker_locked is returned.
  // (The full applyBrokerDayLockout function requires DB + network mocks.)

  it("isAutoLiqConfirmed=false when response is null → broker_locked must not be set", () => {
    const confirmed = isAutoLiqConfirmed({ expectedValue: 500, responseValue: null });
    assert.equal(confirmed, false, "null response must not confirm broker lock");
  });

  it("isAutoLiqConfirmed=false when response is undefined → broker_locked must not be set", () => {
    const confirmed = isAutoLiqConfirmed({ expectedValue: 500, responseValue: undefined });
    assert.equal(confirmed, false, "undefined response must not confirm broker lock");
  });

  it("isAutoLiqConfirmed=true only when read-back value is within 1 cent of sent value", () => {
    assert.equal(isAutoLiqConfirmed({ expectedValue: 250, responseValue: 250.005 }), true);
    assert.equal(isAutoLiqConfirmed({ expectedValue: 250, responseValue: 251 }), false);
  });

  it("read-only connection returns unavailable_read_only — write endpoint never called", () => {
    const result = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "daily_loss_limit",
      connectionStatus: "connected_readonly",
    });
    assert.equal(result.skip, true);
    if (result.skip) assert.equal(result.lockStatus, "unavailable_read_only");
  });

  it("403 from broker → unavailable_permission, not broker_lock_failed", () => {
    const { lockStatus } = classifyEnforcementError({ statusCode: 403 });
    assert.equal(lockStatus, "unavailable_permission");
  });
});

// ── buildAutoLiqProfitUpdatePayload ───────────────────────────────────────────

describe("buildAutoLiqProfitUpdatePayload", () => {
  it("includes id, dailyProfitAutoLiq, and changesLocked=true by default", () => {
    const payload = buildAutoLiqProfitUpdatePayload({ existingId: 42, dailyProfitAutoLiq: 500 });
    assert.equal(payload.id, 42);
    assert.equal(payload.dailyProfitAutoLiq, 500);
    assert.equal(payload.changesLocked, true);
  });

  it("does NOT include doNotUnlock — auto-unlock at next session open must be preserved", () => {
    const payload = buildAutoLiqProfitUpdatePayload({ existingId: 99, dailyProfitAutoLiq: 300 });
    assert.ok(
      !("doNotUnlock" in payload),
      "doNotUnlock must be absent — setting it would permanently trap the account",
    );
  });

  it("does NOT include dailyLossAutoLiq — profit lock must not touch the loss field", () => {
    const payload = buildAutoLiqProfitUpdatePayload({ existingId: 1, dailyProfitAutoLiq: 250 });
    assert.ok(
      !("dailyLossAutoLiq" in payload),
      "profit update payload must not include dailyLossAutoLiq",
    );
  });

  it("payload contains exactly the expected keys", () => {
    const payload = buildAutoLiqProfitUpdatePayload({ existingId: 5, dailyProfitAutoLiq: 200 });
    const keys = Object.keys(payload).sort();
    assert.deepEqual(keys, ["changesLocked", "dailyProfitAutoLiq", "id"]);
  });

  it("is generic — uses the provided existingId, not any hardcoded value", () => {
    const p1 = buildAutoLiqProfitUpdatePayload({ existingId: 111, dailyProfitAutoLiq: 100 });
    const p2 = buildAutoLiqProfitUpdatePayload({ existingId: 222, dailyProfitAutoLiq: 100 });
    assert.equal(p1.id, 111);
    assert.equal(p2.id, 222);
    assert.notEqual(p1.id, p2.id);
  });

  it("changesLocked can be explicitly overridden to false", () => {
    const payload = buildAutoLiqProfitUpdatePayload({ existingId: 1, dailyProfitAutoLiq: 50, changesLocked: false });
    assert.equal(payload.changesLocked, false);
  });
});

// ── buildAutoLiqProfitCreatePayload ───────────────────────────────────────────

describe("buildAutoLiqProfitCreatePayload", () => {
  it("includes accountId, dailyProfitAutoLiq, and changesLocked=true by default", () => {
    const payload = buildAutoLiqProfitCreatePayload({ tvAccountId: 6248, dailyProfitAutoLiq: 300 });
    assert.equal(payload.accountId, 6248);
    assert.equal(payload.dailyProfitAutoLiq, 300);
    assert.equal(payload.changesLocked, true);
  });

  it("does NOT include doNotUnlock", () => {
    const payload = buildAutoLiqProfitCreatePayload({ tvAccountId: 6248, dailyProfitAutoLiq: 100 });
    assert.ok(
      !("doNotUnlock" in payload),
      "doNotUnlock must be absent from the create payload",
    );
  });

  it("does NOT include dailyLossAutoLiq — profit lock must not touch the loss field", () => {
    const payload = buildAutoLiqProfitCreatePayload({ tvAccountId: 6248, dailyProfitAutoLiq: 100 });
    assert.ok(
      !("dailyLossAutoLiq" in payload),
      "profit create payload must not include dailyLossAutoLiq",
    );
  });

  it("is generic — uses the provided tvAccountId, not any hardcoded account", () => {
    const p1 = buildAutoLiqProfitCreatePayload({ tvAccountId: 1001, dailyProfitAutoLiq: 50 });
    const p2 = buildAutoLiqProfitCreatePayload({ tvAccountId: 9999, dailyProfitAutoLiq: 50 });
    assert.equal(p1.accountId, 1001);
    assert.equal(p2.accountId, 9999);
    assert.notEqual(p1.accountId, p2.accountId);
  });

  it("payload contains exactly the expected keys", () => {
    const payload = buildAutoLiqProfitCreatePayload({ tvAccountId: 6248, dailyProfitAutoLiq: 200 });
    const keys = Object.keys(payload).sort();
    assert.deepEqual(keys, ["accountId", "changesLocked", "dailyProfitAutoLiq"]);
  });
});

// ── computeProfitAmountToSet ──────────────────────────────────────────────────

describe("computeProfitAmountToSet", () => {
  it("returns the positive daily P&L directly (profit day)", () => {
    assert.equal(computeProfitAmountToSet(500), 500);
  });

  it("returns 0 for a negative P&L — profit lock only fires when account is profitable", () => {
    assert.equal(computeProfitAmountToSet(-100), 0);
  });

  it("returns 0 for exactly zero", () => {
    assert.equal(computeProfitAmountToSet(0), 0);
  });

  it("returns 0 for null", () => {
    assert.equal(computeProfitAmountToSet(null), 0);
  });

  it("returns 0 for undefined", () => {
    assert.equal(computeProfitAmountToSet(undefined), 0);
  });

  it("returns 0 for NaN", () => {
    assert.equal(computeProfitAmountToSet(NaN), 0);
  });

  it("preserves cent-level precision", () => {
    assert.equal(computeProfitAmountToSet(347.82), 347.82);
  });

  it("uses account-specific profit — different amounts produce different thresholds", () => {
    const a = computeProfitAmountToSet(800);
    const b = computeProfitAmountToSet(400);
    assert.equal(a, 800);
    assert.equal(b, 400);
    assert.notEqual(a, b);
  });
});

// ── profit_target broker enforcement — shouldSkipBrokerEnforcement ────────────

describe("shouldSkipBrokerEnforcement — profit_target trigger", () => {
  it("profit_target on connected_live → skip=false (broker call should proceed)", () => {
    const result = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "profit_target",
      connectionStatus: "connected_live",
    });
    assert.equal(result.skip, false);
  });

  it("profit_target on read-only → skip=true with unavailable_read_only", () => {
    // Read-only gate fires after the trigger gate (profit_target is broker-capable),
    // so the result is unavailable_read_only, not monitoring_only.
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

// ── profit payload regression: daily loss payload is unchanged ────────────────

describe("profit target builder regression — daily loss payloads unchanged", () => {
  it("buildAutoLiqUpdatePayload still uses dailyLossAutoLiq, not dailyProfitAutoLiq", () => {
    const payload = buildAutoLiqUpdatePayload({ existingId: 1, dailyLossAutoLiq: 250 });
    assert.ok("dailyLossAutoLiq" in payload, "loss update payload must contain dailyLossAutoLiq");
    assert.ok(!("dailyProfitAutoLiq" in payload), "loss update payload must not contain dailyProfitAutoLiq");
  });

  it("buildAutoLiqCreatePayload still uses dailyLossAutoLiq, not dailyProfitAutoLiq", () => {
    const payload = buildAutoLiqCreatePayload({ tvAccountId: 1, dailyLossAutoLiq: 250 });
    assert.ok("dailyLossAutoLiq" in payload, "loss create payload must contain dailyLossAutoLiq");
    assert.ok(!("dailyProfitAutoLiq" in payload), "loss create payload must not contain dailyProfitAutoLiq");
  });

  it("profit and loss payloads use different fields — they must not be confused", () => {
    const lossPayload = buildAutoLiqUpdatePayload({ existingId: 1, dailyLossAutoLiq: 250 });
    const profitPayload = buildAutoLiqProfitUpdatePayload({ existingId: 1, dailyProfitAutoLiq: 500 });
    assert.ok("dailyLossAutoLiq" in lossPayload && !("dailyProfitAutoLiq" in lossPayload));
    assert.ok("dailyProfitAutoLiq" in profitPayload && !("dailyLossAutoLiq" in profitPayload));
  });
});

// ── applyBrokerDayLockout — explicit trigger routing ─────────────────────────

describe("applyBrokerDayLockout — explicit trigger routing", () => {
  // applyBrokerDayLockout uses an explicit switch on trigger. These tests prove
  // the routing via the two pure-function layers that control whether and how
  // the broker is called:
  //
  //   Layer 1 — shouldSkipBrokerEnforcement:
  //     Returns skip=true for every trigger that has no broker API. When
  //     skip=true, applyBrokerDayLockout returns before TradovateClient is
  //     instantiated, so applyDailyLossLock/applyProfitTargetLock cannot run.
  //
  //   Layer 2 — payload builders:
  //     For the two broker-enforced triggers, the payload builder used is
  //     specific to that trigger. daily_loss_limit uses dailyLossAutoLiq;
  //     profit_target uses dailyProfitAutoLiq. The switch prevents either
  //     builder from running for the other trigger.

  // ── Layer 1: triggers that must not reach any broker write endpoint ─────

  const INTERNAL_ONLY_TRIGGERS: EnforcementTrigger[] = [
    "trade_limit",
    "consecutive_losses",
    "trading_day_disabled",
    "session_end",
    "manual",
  ];

  for (const trigger of INTERNAL_ONLY_TRIGGERS) {
    it(`${trigger}: skip=true — TradovateClient never instantiated, applyDailyLossLock cannot be called`, () => {
      const result = shouldSkipBrokerEnforcement({
        platform: "tradovate",
        trigger,
        connectionStatus: "connected_live",
      });
      assert.equal(result.skip, true, `${trigger} must not enter the broker path`);
      if (result.skip) assert.equal(result.lockStatus, "monitoring_only");
    });
  }

  // ── Layer 2: broker-enforced triggers use the correct field ────────────

  it("daily_loss_limit: skip=false and payload uses dailyLossAutoLiq — not dailyProfitAutoLiq", () => {
    const skipResult = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "daily_loss_limit",
      connectionStatus: "connected_live",
    });
    assert.equal(skipResult.skip, false, "daily_loss_limit must enter the broker path");

    const updatePayload = buildAutoLiqUpdatePayload({ existingId: 1, dailyLossAutoLiq: 250 });
    const createPayload = buildAutoLiqCreatePayload({ tvAccountId: 1, dailyLossAutoLiq: 250 });
    assert.ok("dailyLossAutoLiq" in updatePayload, "update payload must contain dailyLossAutoLiq");
    assert.ok(!("dailyProfitAutoLiq" in updatePayload), "update payload must not contain dailyProfitAutoLiq");
    assert.ok("dailyLossAutoLiq" in createPayload, "create payload must contain dailyLossAutoLiq");
    assert.ok(!("dailyProfitAutoLiq" in createPayload), "create payload must not contain dailyProfitAutoLiq");
  });

  it("profit_target: skip=false and payload uses dailyProfitAutoLiq — not dailyLossAutoLiq", () => {
    const skipResult = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "profit_target",
      connectionStatus: "connected_live",
    });
    assert.equal(skipResult.skip, false, "profit_target must enter the broker path");

    const updatePayload = buildAutoLiqProfitUpdatePayload({ existingId: 1, dailyProfitAutoLiq: 500 });
    const createPayload = buildAutoLiqProfitCreatePayload({ tvAccountId: 1, dailyProfitAutoLiq: 500 });
    assert.ok("dailyProfitAutoLiq" in updatePayload, "update payload must contain dailyProfitAutoLiq");
    assert.ok(!("dailyLossAutoLiq" in updatePayload), "update payload must not contain dailyLossAutoLiq");
    assert.ok("dailyProfitAutoLiq" in createPayload, "create payload must contain dailyProfitAutoLiq");
    assert.ok(!("dailyLossAutoLiq" in createPayload), "create payload must not contain dailyLossAutoLiq");
  });

  // ── Cross-field guard: the two fields are never mixed ─────────────────

  it("loss and profit payloads never share the other trigger's field", () => {
    const lossUpdate = buildAutoLiqUpdatePayload({ existingId: 1, dailyLossAutoLiq: 100 });
    const lossCreate = buildAutoLiqCreatePayload({ tvAccountId: 1, dailyLossAutoLiq: 100 });
    const profitUpdate = buildAutoLiqProfitUpdatePayload({ existingId: 1, dailyProfitAutoLiq: 200 });
    const profitCreate = buildAutoLiqProfitCreatePayload({ tvAccountId: 1, dailyProfitAutoLiq: 200 });

    assert.ok(!("dailyProfitAutoLiq" in lossUpdate), "loss update must not contain profit field");
    assert.ok(!("dailyProfitAutoLiq" in lossCreate), "loss create must not contain profit field");
    assert.ok(!("dailyLossAutoLiq" in profitUpdate), "profit update must not contain loss field");
    assert.ok(!("dailyLossAutoLiq" in profitCreate), "profit create must not contain loss field");
  });
});
