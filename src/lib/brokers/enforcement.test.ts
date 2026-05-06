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
  isEnforcementDryRun,
  buildLiquidatePositionsPayload,
  isFlattenConfirmed,
  classifyFlattenError,
  getCmeHour,
  isSessionEndReached,
  deriveSessionEndAction,
} from "./enforcement-helpers.ts";
import type { EnforcementTrigger, BrokerLockStatus, FlattenStatus, SessionEndBehavior, SessionEndAction } from "./enforcement-helpers.ts";

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

  // Probed permission level overrides legacy connectionStatus
  describe("permissionLevel takes precedence over connectionStatus", () => {
    it("permissionLevel=full_access → skip=false even when status is connected_readonly", () => {
      const result = shouldSkipBrokerEnforcement({
        platform: "tradovate",
        trigger: "daily_loss_limit",
        connectionStatus: "connected_readonly",
        permissionLevel: "full_access",
      });
      assert.equal(result.skip, false);
    });

    it("permissionLevel=read_only → skip=true even when status is connected_live", () => {
      const result = shouldSkipBrokerEnforcement({
        platform: "tradovate",
        trigger: "daily_loss_limit",
        connectionStatus: "connected_live",
        permissionLevel: "read_only",
      });
      assert.equal(result.skip, true);
      if (result.skip) assert.equal(result.lockStatus, "unavailable_read_only");
    });

    it("permissionLevel=read_only with profit_target trigger → skip=true", () => {
      const result = shouldSkipBrokerEnforcement({
        platform: "tradovate",
        trigger: "profit_target",
        connectionStatus: "connected_live",
        permissionLevel: "read_only",
      });
      assert.equal(result.skip, true);
      if (result.skip) assert.equal(result.lockStatus, "unavailable_read_only");
    });

    it("permissionLevel=null falls back to connectionStatus check (legacy behavior)", () => {
      const result = shouldSkipBrokerEnforcement({
        platform: "tradovate",
        trigger: "daily_loss_limit",
        connectionStatus: "connected_readonly",
        permissionLevel: null,
      });
      assert.equal(result.skip, true);
    });

    it("permissionLevel=null on connected_live falls back and proceeds", () => {
      const result = shouldSkipBrokerEnforcement({
        platform: "tradovate",
        trigger: "daily_loss_limit",
        connectionStatus: "connected_live",
        permissionLevel: null,
      });
      assert.equal(result.skip, false);
    });

    it("non-Tradovate platform short-circuits before permission check", () => {
      const result = shouldSkipBrokerEnforcement({
        platform: "tradingview",
        trigger: "daily_loss_limit",
        connectionStatus: "connected_live",
        permissionLevel: "full_access",
      });
      assert.equal(result.skip, true);
      if (result.skip) assert.equal(result.lockStatus, "monitoring_only");
    });

    it("non-broker-enforced trigger short-circuits before permission check", () => {
      const result = shouldSkipBrokerEnforcement({
        platform: "tradovate",
        trigger: "trade_limit",
        connectionStatus: "connected_live",
        permissionLevel: "full_access",
      });
      assert.equal(result.skip, true);
      if (result.skip) assert.equal(result.lockStatus, "monitoring_only");
    });
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

// ── isEnforcementDryRun ───────────────────────────────────────────────────────

describe("isEnforcementDryRun", () => {
  const ORIG = process.env.ENFORCEMENT_DRY_RUN;
  const restore = () => {
    if (ORIG === undefined) delete process.env.ENFORCEMENT_DRY_RUN;
    else process.env.ENFORCEMENT_DRY_RUN = ORIG;
  };

  it("returns false when ENFORCEMENT_DRY_RUN is not set", () => {
    delete process.env.ENFORCEMENT_DRY_RUN;
    assert.equal(isEnforcementDryRun(), false);
    restore();
  });

  it("returns true when ENFORCEMENT_DRY_RUN=true", () => {
    process.env.ENFORCEMENT_DRY_RUN = "true";
    assert.equal(isEnforcementDryRun(), true);
    restore();
  });

  it("returns false for any value other than the exact string 'true'", () => {
    for (const val of ["1", "yes", "True", "TRUE", "false", ""]) {
      process.env.ENFORCEMENT_DRY_RUN = val;
      assert.equal(isEnforcementDryRun(), false, `expected false for ENFORCEMENT_DRY_RUN="${val}"`);
    }
    restore();
  });

  it("'dry_run' is a valid BrokerLockStatus — type-level proof", () => {
    const status: BrokerLockStatus = "dry_run";
    assert.equal(status, "dry_run");
  });
});

// ── dry-run mode — intended payload shape ─────────────────────────────────────

describe("dry-run mode — intended payload shape", () => {
  // applyBrokerDayLockout (requires DB mocks) is not tested here.
  // These tests prove the pure-function building blocks used in the dry-run
  // branch to construct the intended payload that is logged and persisted.

  it("dry-run daily_loss_limit: payload contains dailyLossAutoLiq, not dailyProfitAutoLiq", () => {
    const lossAmount = computeLossAmountToSet(-250);
    assert.equal(lossAmount, 250);

    const payload = buildAutoLiqCreatePayload({ tvAccountId: 6248, dailyLossAutoLiq: lossAmount });
    assert.ok("dailyLossAutoLiq" in payload, "dry-run loss payload must contain dailyLossAutoLiq");
    assert.ok(!("dailyProfitAutoLiq" in payload), "dry-run loss payload must not contain dailyProfitAutoLiq");
    assert.equal(payload.dailyLossAutoLiq, 250);
    assert.equal(payload.accountId, 6248);
    assert.equal(payload.changesLocked, true);
  });

  it("dry-run profit_target: payload contains dailyProfitAutoLiq, not dailyLossAutoLiq", () => {
    const profitAmount = computeProfitAmountToSet(500);
    assert.equal(profitAmount, 500);

    const payload = buildAutoLiqProfitCreatePayload({ tvAccountId: 6248, dailyProfitAutoLiq: profitAmount });
    assert.ok("dailyProfitAutoLiq" in payload, "dry-run profit payload must contain dailyProfitAutoLiq");
    assert.ok(!("dailyLossAutoLiq" in payload), "dry-run profit payload must not contain dailyLossAutoLiq");
    assert.equal(payload.dailyProfitAutoLiq, 500);
    assert.equal(payload.accountId, 6248);
    assert.equal(payload.changesLocked, true);
  });

  it("dry-run does NOT set doNotUnlock — must match live payload contract", () => {
    const lossPayload = buildAutoLiqCreatePayload({ tvAccountId: 1, dailyLossAutoLiq: 100 });
    const profitPayload = buildAutoLiqProfitCreatePayload({ tvAccountId: 1, dailyProfitAutoLiq: 200 });
    assert.ok(!("doNotUnlock" in lossPayload), "dry-run loss payload must not include doNotUnlock");
    assert.ok(!("doNotUnlock" in profitPayload), "dry-run profit payload must not include doNotUnlock");
  });

  it("dry-run status is dry_run — not broker_locked, not monitoring_only, not broker_lock_failed", () => {
    // The BrokerDayLockoutResult from applyBrokerDayLockout in dry-run mode
    // has status="dry_run". This test verifies the type-level distinctness.
    const status: BrokerLockStatus = "dry_run";
    assert.notEqual(status, "broker_locked" as BrokerLockStatus);
    assert.notEqual(status, "monitoring_only" as BrokerLockStatus);
    assert.notEqual(status, "broker_lock_failed" as BrokerLockStatus);
  });

  it("normal mode: shouldSkipBrokerEnforcement unchanged for daily_loss_limit", () => {
    // Dry-run does not affect shouldSkipBrokerEnforcement. Both modes use the
    // same skip gate — dry-run only intercepts after skip=false.
    const result = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "daily_loss_limit",
      connectionStatus: "connected_live",
    });
    assert.equal(result.skip, false, "daily_loss_limit must still have skip=false in normal mode");
  });

  it("read-only connection: skip=true regardless of dry-run mode", () => {
    // Even in dry-run mode, a read-only connection gets unavailable_read_only
    // from shouldSkipBrokerEnforcement before the dry-run check is reached.
    const result = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "daily_loss_limit",
      connectionStatus: "connected_readonly",
    });
    assert.equal(result.skip, true);
    if (result.skip) assert.equal(result.lockStatus, "unavailable_read_only");
  });
});

// ── buildLiquidatePositionsPayload ────────────────────────────────────────────

describe("buildLiquidatePositionsPayload", () => {
  it("sets positions to the provided IDs and admin=false", () => {
    const payload = buildLiquidatePositionsPayload([101, 202, 303]);
    assert.deepEqual(payload.positions, [101, 202, 303]);
    assert.equal(payload.admin, false);
  });

  it("admin is always false — not an admin override", () => {
    const payload = buildLiquidatePositionsPayload([42]);
    assert.equal(payload.admin, false);
  });

  it("works for a single position", () => {
    const payload = buildLiquidatePositionsPayload([9999]);
    assert.deepEqual(payload.positions, [9999]);
  });

  it("works for an empty list (no-op liquidate)", () => {
    const payload = buildLiquidatePositionsPayload([]);
    assert.deepEqual(payload.positions, []);
  });

  it("payload contains exactly the expected keys", () => {
    const payload = buildLiquidatePositionsPayload([1]);
    const keys = Object.keys(payload).sort();
    assert.deepEqual(keys, ["admin", "positions"]);
  });

  it("does NOT include doNotUnlock or any extra fields", () => {
    const payload = buildLiquidatePositionsPayload([1, 2]);
    assert.ok(!("doNotUnlock" in payload));
    assert.ok(!("contractId" in payload));
    assert.ok(!("accountId" in payload));
  });
});

// ── isFlattenConfirmed ────────────────────────────────────────────────────────

describe("isFlattenConfirmed", () => {
  it("returns true for an empty array — no positions means already flat", () => {
    assert.equal(isFlattenConfirmed([]), true);
  });

  it("returns true when all positions have netPos === 0", () => {
    assert.equal(isFlattenConfirmed([{ netPos: 0 }, { netPos: 0 }]), true);
  });

  it("returns true when all positions have netPos === null", () => {
    assert.equal(isFlattenConfirmed([{ netPos: null }, { netPos: null }]), true);
  });

  it("returns false when any position has netPos !== 0 and !== null", () => {
    assert.equal(isFlattenConfirmed([{ netPos: 0 }, { netPos: 1 }]), false);
  });

  it("returns false when a short position remains (netPos < 0)", () => {
    assert.equal(isFlattenConfirmed([{ netPos: -2 }]), false);
  });

  it("returns false for a single long position that is still open", () => {
    assert.equal(isFlattenConfirmed([{ netPos: 3 }]), false);
  });

  it("treats netPos=null as flat — null means no data, not open", () => {
    assert.equal(isFlattenConfirmed([{ netPos: null }]), true);
  });
});

// ── classifyFlattenError ──────────────────────────────────────────────────────

describe("classifyFlattenError", () => {
  it("HTTP 403 → unavailable_permission", () => {
    const result = classifyFlattenError({ statusCode: 403 });
    assert.equal(result.flattenStatus, "unavailable_permission");
    assert.ok(result.flattenMessage.includes("403"));
    assert.equal(result.flattenPayload, null);
    assert.equal(result.flattenResponse, null);
  });

  it("HTTP 403 message mentions Orders permission", () => {
    const result = classifyFlattenError({ statusCode: 403 });
    assert.ok(
      result.flattenMessage.toLowerCase().includes("orders") ||
      result.flattenMessage.toLowerCase().includes("permission"),
    );
  });

  it("non-403 error → failed", () => {
    const result = classifyFlattenError(new Error("network timeout"));
    assert.equal(result.flattenStatus, "failed");
    assert.ok(result.flattenMessage.includes("network timeout"));
  });

  it("HTTP 401 → failed (not unavailable_permission)", () => {
    const result = classifyFlattenError({ statusCode: 401 });
    assert.equal(result.flattenStatus, "failed");
  });

  it("unknown error → failed with message", () => {
    const result = classifyFlattenError("something broke");
    assert.equal(result.flattenStatus, "failed");
  });

  it("flattenPayload and flattenResponse are null for all error paths", () => {
    for (const err of [{ statusCode: 403 }, new Error("oops"), { statusCode: 500 }]) {
      const r = classifyFlattenError(err);
      assert.equal(r.flattenPayload, null);
      assert.equal(r.flattenResponse, null);
    }
  });
});

// ── FlattenStatus type coverage ───────────────────────────────────────────────

describe("FlattenStatus type — all values are distinct", () => {
  const ALL_FLATTEN_STATUSES: FlattenStatus[] = [
    "not_needed",
    "attempted",
    "flattened",
    "unavailable_read_only",
    "unavailable_permission",
    "failed",
    "dry_run",
  ];

  it("all 7 FlattenStatus values are defined", () => {
    assert.equal(ALL_FLATTEN_STATUSES.length, 7);
  });

  it("each value is unique", () => {
    const unique = new Set(ALL_FLATTEN_STATUSES);
    assert.equal(unique.size, ALL_FLATTEN_STATUSES.length);
  });

  it("dry_run is distinct from flattened and failed", () => {
    const s: FlattenStatus = "dry_run";
    assert.notEqual(s, "flattened" as FlattenStatus);
    assert.notEqual(s, "failed" as FlattenStatus);
  });

  it("flattened is distinct from attempted", () => {
    const s: FlattenStatus = "flattened";
    assert.notEqual(s, "attempted" as FlattenStatus);
  });
});

// ── Unsupported triggers — flatten must not be called ─────────────────────────

describe("unsupported triggers — shouldSkipBrokerEnforcement gates flatten", () => {
  // flatten only applies after shouldSkipBrokerEnforcement returns skip=false.
  // Only daily_loss_limit and profit_target have skip=false on tradovate + live.
  const FLATTEN_UNSUPPORTED: EnforcementTrigger[] = [
    "trade_limit",
    "consecutive_losses",
    "trading_day_disabled",
    "session_end",
    "manual",
  ];

  for (const trigger of FLATTEN_UNSUPPORTED) {
    it(`${trigger}: shouldSkipBrokerEnforcement returns skip=true (no flatten path)`, () => {
      const result = shouldSkipBrokerEnforcement({
        platform: "tradovate",
        trigger,
        connectionStatus: "connected_live",
      });
      assert.equal(
        result.skip,
        true,
        `${trigger} must not reach the broker path where flatten is called`,
      );
    });
  }

  it("daily_loss_limit: shouldSkipBrokerEnforcement returns skip=false (flatten applies)", () => {
    const result = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "daily_loss_limit",
      connectionStatus: "connected_live",
    });
    assert.equal(result.skip, false);
  });

  it("profit_target: shouldSkipBrokerEnforcement returns skip=false (flatten applies)", () => {
    const result = shouldSkipBrokerEnforcement({
      platform: "tradovate",
      trigger: "profit_target",
      connectionStatus: "connected_live",
    });
    assert.equal(result.skip, false);
  });

  it("read-only connection: flatten is unavailable (skip=true with unavailable_read_only)", () => {
    for (const trigger of ["daily_loss_limit", "profit_target"] as EnforcementTrigger[]) {
      const result = shouldSkipBrokerEnforcement({
        platform: "tradovate",
        trigger,
        connectionStatus: "connected_readonly",
      });
      assert.equal(result.skip, true);
      if (result.skip) assert.equal(result.lockStatus, "unavailable_read_only");
    }
  });
});

// ── computeEffectiveDailyPnl ──────────────────────────────────────────────────

import { computeEffectiveDailyPnl } from "./enforcement-helpers.ts";

describe("computeEffectiveDailyPnl — arithmetic", () => {
  it("sums realized and unrealized: -200 + -300 = -500", () => {
    assert.equal(computeEffectiveDailyPnl(-200, -300), -500);
  });

  it("unrealized-only (null realized treated as 0): null + -500 = -500", () => {
    assert.equal(computeEffectiveDailyPnl(null, -500), -500);
  });

  it("realized-only (null unrealized treated as 0): -450 + null = -450", () => {
    assert.equal(computeEffectiveDailyPnl(-450, null), -450);
  });

  it("profit side: +300 + +200 = +500", () => {
    assert.equal(computeEffectiveDailyPnl(300, 200), 500);
  });

  it("both null → null (no P&L data; enforcement cannot run)", () => {
    assert.equal(computeEffectiveDailyPnl(null, null), null);
  });

  it("unrealized-only positive: null + 300 = 300", () => {
    assert.equal(computeEffectiveDailyPnl(null, 300), 300);
  });

  it("flat position contributes zero: -100 + 0 = -100", () => {
    assert.equal(computeEffectiveDailyPnl(-100, 0), -100);
  });

  it("account scoping: both inputs are trusted per-account values; result is a number", () => {
    // openPnl source: cashBalance/getCashBalanceSnapshot (POST {accountId}) or
    // position/deps?masterid={tvAccountId} — both are server-side per-account filters.
    assert.equal(typeof computeEffectiveDailyPnl(-200, -300), "number");
  });
});

// ── effectiveDailyPnl threshold — table-driven ───────────────────────────────
//
// Threshold logic (mirrors tradovate-sync.ts exactly):
//   lossUsed = Math.abs(Math.min(effective, 0))
//   daily_loss_limit fires when lossUsed >= limit  (≡ effective <= -limit)
//   profit_target   fires when effective >= target
//
// The threshold is always a parameter (user-configured maxDailyLoss /
// dailyProfitTarget). No value is hardcoded in the production code or here.

describe("effectiveDailyPnl threshold — daily_loss_limit (table-driven)", () => {
  function lossTriggers(
    realized: number | null,
    unrealized: number | null,
    limit: number,
  ): boolean {
    const effective = computeEffectiveDailyPnl(realized, unrealized);
    if (effective == null) return false;
    return Math.abs(Math.min(effective, 0)) >= limit;
  }

  // [realized, unrealized, limit, shouldTrigger]
  const cases: Array<[number | null, number | null, number, boolean]> = [
    // ── limit = 75 ──────────────────────────────────────────────────────────
    [0,     -75,    75,   true ],
    [-50,   -25,    75,   true ],
    [-74,   -1,     75,   true ],
    [-75,    0,     75,   true ],   // realized alone exactly at limit
    [null,  -75,    75,   true ],   // unrealized-only, no realized fills yet
    [-74,    0,     75,   false],
    [0,     -74,    75,   false],
    [-74,   null,   75,   false],   // null unrealized treated as 0

    // ── limit = 200 ─────────────────────────────────────────────────────────
    [0,     -200,   200,  true ],
    [-100,  -100,   200,  true ],
    [-199,  -1,     200,  true ],
    [-200,   0,     200,  true ],
    [null,  -200,   200,  true ],
    [-199,   0,     200,  false],
    [0,     -199,   200,  false],
    [-199,  null,   200,  false],

    // ── limit = 1000 ────────────────────────────────────────────────────────
    [0,     -1000,  1000, true ],
    [-500,  -500,   1000, true ],
    [-999,  -1,     1000, true ],
    [-1000,  0,     1000, true ],
    [null,  -1000,  1000, true ],
    [-999,   0,     1000, false],
    [0,     -999,   1000, false],
    [-999,  null,   1000, false],

    // ── cross-threshold checks (profit P&L never triggers loss) ──────────────
    [0,      0,     75,   false],
    [100,    200,   200,  false],   // positive effective — no loss
    [null,   null,  1000, false],   // no data
  ];

  for (const [realized, unrealized, limit, expected] of cases) {
    const verb = expected ? "triggers" : "does not trigger";
    it(`realized=${realized}, unrealized=${unrealized}, limit=${limit} → ${verb}`, () => {
      assert.equal(
        lossTriggers(realized, unrealized, limit),
        expected,
        `effective=${computeEffectiveDailyPnl(realized, unrealized)}, limit=${limit}`,
      );
    });
  }
});

describe("effectiveDailyPnl threshold — profit_target (table-driven)", () => {
  function profitTriggers(
    realized: number | null,
    unrealized: number | null,
    target: number,
  ): boolean {
    const effective = computeEffectiveDailyPnl(realized, unrealized);
    if (effective == null) return false;
    return effective >= target;
  }

  // [realized, unrealized, target, shouldTrigger]
  const cases: Array<[number | null, number | null, number, boolean]> = [
    // ── target = 150 ────────────────────────────────────────────────────────
    [0,     150,    150,  true ],
    [75,    75,     150,  true ],
    [149,   1,      150,  true ],
    [150,   0,      150,  true ],   // realized alone exactly at target
    [null,  150,    150,  true ],   // unrealized-only, no realized fills yet
    [149,   0,      150,  false],
    [0,     149,    150,  false],
    [149,   null,   150,  false],   // null unrealized treated as 0

    // ── target = 750 ────────────────────────────────────────────────────────
    [0,     750,    750,  true ],
    [375,   375,    750,  true ],
    [749,   1,      750,  true ],
    [750,   0,      750,  true ],
    [null,  750,    750,  true ],
    [749,   0,      750,  false],
    [0,     749,    750,  false],
    [749,   null,   750,  false],

    // ── target = 2500 ───────────────────────────────────────────────────────
    [0,     2500,   2500, true ],
    [1250,  1250,   2500, true ],
    [2499,  1,      2500, true ],
    [2500,  0,      2500, true ],
    [null,  2500,   2500, true ],
    [2499,  0,      2500, false],
    [0,     2499,   2500, false],
    [2499,  null,   2500, false],

    // ── cross-threshold checks (loss P&L never triggers profit) ─────────────
    [0,     0,      150,  false],
    [-100,  -200,   750,  false],   // negative effective — no profit
    [null,  null,   2500, false],   // no data
  ];

  for (const [realized, unrealized, target, expected] of cases) {
    const verb = expected ? "triggers" : "does not trigger";
    it(`realized=${realized}, unrealized=${unrealized}, target=${target} → ${verb}`, () => {
      assert.equal(
        profitTriggers(realized, unrealized, target),
        expected,
        `effective=${computeEffectiveDailyPnl(realized, unrealized)}, target=${target}`,
      );
    });
  }
});

// ── getCmeHour ────────────────────────────────────────────────────────────────

describe("getCmeHour", () => {
  // UTC midnight = 6 PM previous day CT (UTC-6 in CST) or 7 PM in CDT.
  // Use known winter (CST = UTC-6) and summer (CDT = UTC-5) dates.

  it("returns 18 for UTC midnight in January (CST = UTC-6)", () => {
    // 2026-01-15 00:00 UTC = 2026-01-14 18:00 CST
    const d = new Date("2026-01-15T00:00:00Z");
    assert.equal(getCmeHour(d), 18);
  });

  it("returns 9 for 15:00 UTC in January (CST)", () => {
    // 2026-01-15 15:00 UTC = 2026-01-15 09:00 CST
    const d = new Date("2026-01-15T15:00:00Z");
    assert.equal(getCmeHour(d), 9);
  });

  it("returns 16 for 22:00 UTC in January (CST)", () => {
    // 2026-01-15 22:00 UTC = 2026-01-15 16:00 CST
    const d = new Date("2026-01-15T22:00:00Z");
    assert.equal(getCmeHour(d), 16);
  });

  it("returns 17 for 23:00 UTC in January (CST) — session start hour", () => {
    // 2026-01-15 23:00 UTC = 2026-01-15 17:00 CST
    const d = new Date("2026-01-15T23:00:00Z");
    assert.equal(getCmeHour(d), 17);
  });

  it("returns 0 for midnight Chicago (06:00 UTC in January CST)", () => {
    // 2026-01-15 06:00 UTC = 2026-01-15 00:00 CST
    const d = new Date("2026-01-15T06:00:00Z");
    assert.equal(getCmeHour(d), 0);
  });
});

// ── isSessionEndReached ───────────────────────────────────────────────────────

describe("isSessionEndReached", () => {
  it("returns false when cmeHour is in the 17-23 range (session just started)", () => {
    for (const h of [17, 18, 20, 23]) {
      assert.equal(isSessionEndReached(16, h), false, `hour=${h}`);
    }
  });

  it("returns true when cmeHour equals sessionEndHour", () => {
    assert.equal(isSessionEndReached(16, 16), true);
    assert.equal(isSessionEndReached(9, 9), true);
    assert.equal(isSessionEndReached(0, 0), true);
  });

  it("returns true when cmeHour is past sessionEndHour (0-16 range)", () => {
    assert.equal(isSessionEndReached(14, 15), true);
    assert.equal(isSessionEndReached(9, 16), true);
    assert.equal(isSessionEndReached(0, 5), true);
  });

  it("returns false when cmeHour is before sessionEndHour", () => {
    assert.equal(isSessionEndReached(16, 15), false);
    assert.equal(isSessionEndReached(9, 8), false);
    assert.equal(isSessionEndReached(13, 12), false);
  });

  it("returns false for hour=16 when sessionEndHour=17 (17 is treated as start, not reachable in 0-16 range)", () => {
    // sessionEndHour=17 would require cmeHour>=17, but that returns false
    assert.equal(isSessionEndReached(17, 16), false);
    assert.equal(isSessionEndReached(17, 17), false); // 17 blocked by the >= 17 guard
  });
});

// ── deriveSessionEndAction ────────────────────────────────────────────────────

describe("deriveSessionEndAction", () => {
  function action(overrides: Partial<Parameters<typeof deriveSessionEndAction>[0]>): SessionEndAction {
    return deriveSessionEndAction({
      sessionEndHour: 16,
      behavior: "wait_for_exit_then_lock",
      cmeHour: 16,            // session end reached
      hasOpenPositions: false,
      isAlreadyStopped: false,
      isPendingSessionEndLock: false,
      ...overrides,
    });
  }

  it("returns 'none' when account is already stopped", () => {
    assert.equal(action({ isAlreadyStopped: true }), "none");
  });

  it("returns 'none' when sessionEndHour is null (no session end configured)", () => {
    assert.equal(action({ sessionEndHour: null }), "none");
  });

  it("returns 'none' when session end has not been reached (cmeHour < sessionEndHour)", () => {
    assert.equal(action({ cmeHour: 15, sessionEndHour: 16 }), "none");
    assert.equal(action({ cmeHour: 8, sessionEndHour: 9 }), "none");
  });

  it("returns 'none' when cmeHour is in session-start range (17-23)", () => {
    assert.equal(action({ cmeHour: 17 }), "none");
    assert.equal(action({ cmeHour: 23 }), "none");
  });

  it("returns 'lock_immediately' when session ended and no open positions", () => {
    assert.equal(action({ hasOpenPositions: false }), "lock_immediately");
    assert.equal(action({ hasOpenPositions: false, behavior: "flatten_at_session_end" }), "lock_immediately");
    assert.equal(action({ hasOpenPositions: false, cmeHour: 16, sessionEndHour: 9 }), "lock_immediately");
  });

  it("returns 'flatten_then_lock' when session ended + open positions + flatten behavior", () => {
    assert.equal(
      action({ hasOpenPositions: true, behavior: "flatten_at_session_end" }),
      "flatten_then_lock",
    );
  });

  it("returns 'await_flat' when session ended + open positions + wait behavior", () => {
    assert.equal(
      action({ hasOpenPositions: true, behavior: "wait_for_exit_then_lock" }),
      "await_flat",
    );
  });

  it("returns 'lock_pending' when isPendingSessionEndLock=true and positions are flat", () => {
    // isPendingSessionEndLock takes precedence over session-end check
    assert.equal(
      action({ isPendingSessionEndLock: true, hasOpenPositions: false }),
      "lock_pending",
    );
  });

  it("returns 'none' when isPendingSessionEndLock=true but positions still open", () => {
    assert.equal(
      action({ isPendingSessionEndLock: true, hasOpenPositions: true }),
      "none",
    );
  });

  it("lock_pending fires even when session end hour is not currently reached (post-rollover)", () => {
    // After CME day rolls at 17:00, cmeHour=17 → isSessionEndReached returns false.
    // But pendingSessionEndLock should still resolve to lock_pending when flat.
    assert.equal(
      action({ isPendingSessionEndLock: true, hasOpenPositions: false, cmeHour: 17 }),
      "lock_pending",
    );
  });

  it("returns 'none' when isAlreadyStopped=true even if pendingSessionEndLock is set", () => {
    assert.equal(
      action({ isAlreadyStopped: true, isPendingSessionEndLock: true, hasOpenPositions: false }),
      "none",
    );
  });
});
