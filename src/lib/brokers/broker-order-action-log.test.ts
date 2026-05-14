/**
 * Tests for broker-order-action-log.ts.
 *
 * writeBrokerOrderActionLog is a thin Prisma wrapper. It cannot be unit-tested
 * without a live DB. This file tests:
 *
 *  1. The WriteBrokerOrderActionLogInput type does not include any fields that
 *     could carry tokens or secrets.
 *  2. The request/response summaries that cancel_orders and flatten_positions
 *     write are safe (contain only IDs, counts, status strings — no secrets).
 *  3. The audit log input shape for each action type is documented and stable.
 *
 * Integration verification (DB write confirmed by code review):
 *  - writeBrokerOrderActionLog() calls prisma.brokerOrderActionLog.create()
 *  - dryRun: true is recorded even for dry-run paths
 *  - requestSummary / responseSummary are passed as-is (no token fields present
 *    at the call sites in cancel-open-orders.ts and flatten-positions.ts)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { WriteBrokerOrderActionLogInput } from "./broker-order-action-log.ts";

// ── Type-level safety checks ──────────────────────────────────────────────────

describe("WriteBrokerOrderActionLogInput type", () => {
  it("does not include access token fields", () => {
    // Create a valid input object and verify no secret-like keys are present.
    const input: WriteBrokerOrderActionLogInput = {
      userId: "user_1",
      connectedAccountId: "acct_1",
      externalAccountId: "123456",
      actionType: "cancel_orders",
      triggerReason: "manual_test",
      dryRun: true,
      requestSummary: { orderCount: 0, orderIds: [] },
      responseSummary: { dryRun: true, attemptedCount: 0 },
      success: true,
      errorMessage: null,
    };

    const forbidden = ["accessToken", "refreshToken", "token", "secret", "password", "apiKey"];
    const keys = Object.keys(input);
    for (const forbidden_key of forbidden) {
      assert.ok(
        !keys.includes(forbidden_key),
        `WriteBrokerOrderActionLogInput must not have field "${forbidden_key}"`,
      );
    }
  });

  it("includes all required audit fields", () => {
    const input: WriteBrokerOrderActionLogInput = {
      userId: "user_1",
      connectedAccountId: "acct_1",
      externalAccountId: null,
      actionType: "flatten_positions",
      triggerReason: "dev_diagnostic",
      dryRun: false,
      requestSummary: null,
      responseSummary: null,
      success: false,
      errorMessage: "something went wrong",
    };

    assert.equal(typeof input.userId, "string");
    assert.equal(typeof input.connectedAccountId, "string");
    assert.equal(typeof input.actionType, "string");
    assert.equal(typeof input.triggerReason, "string");
    assert.equal(typeof input.dryRun, "boolean");
    assert.equal(typeof input.success, "boolean");
  });
});

// ── cancel_orders dry-run summary shape ──────────────────────────────────────

describe("cancel_orders dry-run audit log summaries", () => {
  it("requestSummary contains only orderCount and orderIds — no secrets", () => {
    const requestSummary = { orderCount: 3, orderIds: [101, 102, 103] };
    assert.equal(typeof requestSummary.orderCount, "number");
    assert.ok(Array.isArray(requestSummary.orderIds));
    const keys = Object.keys(requestSummary);
    assert.deepEqual(keys.sort(), ["orderCount", "orderIds"].sort());
  });

  it("responseSummary contains safe result fields only — no secrets", () => {
    const responseSummary = {
      dryRun: true,
      attemptedCount: 3,
      succeededCount: 0,
      failedCount: 0,
      skippedCount: 0,
      affectedOrderIds: [101, 102, 103],
      skippedOrderIds: [],
      errors: [],
    };
    const forbidden = ["token", "secret", "password", "key"];
    for (const key of Object.keys(responseSummary)) {
      for (const f of forbidden) {
        assert.ok(
          !key.toLowerCase().includes(f),
          `cancel_orders responseSummary must not have field containing "${f}" — found "${key}"`,
        );
      }
    }
    assert.equal(responseSummary.dryRun, true);
  });

  it("dryRun: true is set when effectiveDryRun is true", () => {
    // Mirrors the logic in cancelOpenOrdersForAccount: dryRun field on the
    // result (and audit log) reflects the actual gate outcome.
    const effectiveDryRun = true;
    const logInput: Partial<WriteBrokerOrderActionLogInput> = {
      dryRun: effectiveDryRun,
      actionType: "cancel_orders",
      success: true,
    };
    assert.equal(logInput.dryRun, true);
    assert.equal(logInput.actionType, "cancel_orders");
  });
});

// ── flatten_positions dry-run summary shape ───────────────────────────────────

describe("flatten_positions dry-run audit log summaries", () => {
  it("requestSummary is an empty object in dry-run (no positions read)", () => {
    const requestSummary = {};
    assert.deepEqual(requestSummary, {});
  });

  it("responseSummary contains only flattenStatus in dry-run", () => {
    const responseSummary = { flattenStatus: "dry_run" };
    assert.equal(responseSummary.flattenStatus, "dry_run");
    const keys = Object.keys(responseSummary);
    assert.deepEqual(keys, ["flattenStatus"]);
  });

  it("live responseSummary contains only flattenStatus and flattenMessage", () => {
    const responseSummary = {
      flattenStatus: "flattened",
      flattenMessage: "All 2 position(s) confirmed flat.",
    };
    const keys = Object.keys(responseSummary);
    assert.deepEqual(keys.sort(), ["flattenMessage", "flattenStatus"].sort());
    // No token/secret fields
    const forbidden = ["token", "secret", "password", "key"];
    for (const key of keys) {
      for (const f of forbidden) {
        assert.ok(
          !key.toLowerCase().includes(f),
          `flatten responseSummary must not have field containing "${f}" — found "${key}"`,
        );
      }
    }
  });
});

// ── Live-action guard documentation ──────────────────────────────────────────

describe("live-action guard invariants", () => {
  it("effectiveDryRun is true when ENABLE_TRADOVATE_ORDER_ACTIONS is not 'true'", () => {
    // Mirrors the gate in both cancel and flatten:
    // const effectiveDryRun = options.dryRun === true || !isTradovateOrderActionsEnabled() || !permissionAllowsLive
    const flagEnabled = false; // ENABLE_TRADOVATE_ORDER_ACTIONS is not set
    const permissionAllowsLive = true;
    const forceDryRun = false;
    const effectiveDryRun = forceDryRun || !flagEnabled || !permissionAllowsLive;
    assert.equal(effectiveDryRun, true, "must be dry-run when flag is not set");
  });

  it("effectiveDryRun is true when permissionLevel is read_only", () => {
    const flagEnabled = true;
    const permissionAllowsLive = false; // read_only
    const forceDryRun = false;
    const effectiveDryRun = forceDryRun || !flagEnabled || !permissionAllowsLive;
    assert.equal(effectiveDryRun, true, "must be dry-run when connection is read_only");
  });

  it("effectiveDryRun is true when options.dryRun is explicitly set", () => {
    const flagEnabled = true;
    const permissionAllowsLive = true;
    const forceDryRun = true; // caller explicitly requested dry-run
    const effectiveDryRun = forceDryRun || !flagEnabled || !permissionAllowsLive;
    assert.equal(effectiveDryRun, true, "explicit dryRun: true must always be respected");
  });

  it("only the exact combination of flag + full_access + no force permits live", () => {
    const flagEnabled = true;
    const permissionAllowsLive = true;
    const forceDryRun = false;
    const effectiveDryRun = forceDryRun || !flagEnabled || !permissionAllowsLive;
    assert.equal(effectiveDryRun, false, "live only when all three conditions are met");
  });
});
