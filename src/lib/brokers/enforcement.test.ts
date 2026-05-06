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
  computeLossAmountToSet,
  shouldSkipBrokerEnforcement,
  classifyEnforcementError,
} from "./enforcement-helpers.ts";

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
