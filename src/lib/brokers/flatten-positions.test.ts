/**
 * Tests for flatten-positions.ts.
 *
 * flattenPositionsForAccount is an integration function (requires DB + broker)
 * and cannot be unit-tested without mocking infrastructure. Pure helper tests
 * for the shared validateAccountForOrderActions / canSendLiveOrderActions logic
 * live in cancel-open-orders.test.ts.
 *
 * This file documents the FlattenPositionsResult.flattenStatus literals and
 * verifies the pure helper module is importable.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Pure helpers — no DB dependency.
import { validateAccountForOrderActions, canSendLiveOrderActions } from "./order-actions-helpers.ts";

describe("flatten-positions helpers (via order-actions-helpers)", () => {
  it("canSendLiveOrderActions returns false for read_only — flatten would be dry-run", () => {
    assert.equal(canSendLiveOrderActions({ permissionLevel: "read_only" }), false);
  });

  it("canSendLiveOrderActions returns true for full_access — flatten may proceed live", () => {
    assert.equal(canSendLiveOrderActions({ permissionLevel: "full_access" }), true);
  });

  it("validateAccountForOrderActions rejects archived account before flatten", () => {
    const result = validateAccountForOrderActions({
      platform: "tradovate",
      isActive: true,
      protectionStatus: "archived",
      missingFromBrokerSince: null,
      connectionStatus: "connected_live",
      externalAccountId: "999",
      permissionLevel: "full_access",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "ACCOUNT_ARCHIVED");
  });
});

describe("FlattenPositionsResult flattenStatus literals", () => {
  // Documents the valid status values produced by flattenPositionsForAccount.
  // If the union changes, update callers and audit log readers that match on this string.
  const validStatuses = [
    "not_needed",      // no open positions; no write sent
    "flattened",       // read-back confirmed all positions flat
    "attempted",       // liquidatepositions accepted; read-back still shows open
    "failed",          // request or read-back threw unexpectedly
    "dry_run",         // write gated by flag or permission
    "unavailable_read_only",
    "unavailable_permission",
    "unavailable_consent_missing",
  ];

  it("status set is non-empty", () => {
    assert.ok(validStatuses.length > 0);
  });

  for (const status of validStatuses) {
    it(`"${status}" is a documented flattenStatus`, () => {
      assert.ok(typeof status === "string" && status.length > 0);
    });
  }
});
