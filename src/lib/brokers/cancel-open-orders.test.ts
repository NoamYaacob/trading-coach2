import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  validateAccountForOrderActions,
  canSendLiveOrderActions,
  type OrderActionsAccountState,
} from "./order-actions-helpers.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeAccount(overrides: Partial<OrderActionsAccountState> = {}): OrderActionsAccountState {
  return {
    platform: "tradovate",
    isActive: true,
    protectionStatus: "protected",
    missingFromBrokerSince: null,
    connectionStatus: "connected_live",
    externalAccountId: "123456",
    permissionLevel: "full_access",
    ...overrides,
  };
}

// ── validateAccountForOrderActions ────────────────────────────────────────────

describe("validateAccountForOrderActions", () => {
  it("returns ok:true for a fully connected Tradovate account", () => {
    const result = validateAccountForOrderActions(makeAccount());
    assert.deepEqual(result, { ok: true });
  });

  it("rejects non-Tradovate platform", () => {
    const result = validateAccountForOrderActions(makeAccount({ platform: "manual" }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "UNSUPPORTED_PLATFORM");
  });

  it("rejects inactive account", () => {
    const result = validateAccountForOrderActions(makeAccount({ isActive: false }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "ACCOUNT_INACTIVE");
  });

  it("rejects archived account", () => {
    const result = validateAccountForOrderActions(
      makeAccount({ protectionStatus: "archived" }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "ACCOUNT_ARCHIVED");
  });

  it("rejects account missing from broker", () => {
    const result = validateAccountForOrderActions(
      makeAccount({ missingFromBrokerSince: new Date("2026-01-01") }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "ACCOUNT_UNAVAILABLE");
  });

  it("rejects not_connected status", () => {
    const result = validateAccountForOrderActions(
      makeAccount({ connectionStatus: "not_connected" }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CONNECTION_INACTIVE");
  });

  it("rejects expired status", () => {
    const result = validateAccountForOrderActions(
      makeAccount({ connectionStatus: "expired" }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CONNECTION_INACTIVE");
  });

  it("rejects connection_error status", () => {
    const result = validateAccountForOrderActions(
      makeAccount({ connectionStatus: "connection_error" }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CONNECTION_INACTIVE");
  });

  it("rejects pending_webhook status", () => {
    const result = validateAccountForOrderActions(
      makeAccount({ connectionStatus: "pending_webhook" }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CONNECTION_PENDING");
  });

  it("rejects oauth_pending_storage status", () => {
    const result = validateAccountForOrderActions(
      makeAccount({ connectionStatus: "oauth_pending_storage" }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CONNECTION_PENDING");
  });

  it("rejects null externalAccountId", () => {
    const result = validateAccountForOrderActions(
      makeAccount({ externalAccountId: null }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NO_EXTERNAL_ACCOUNT_ID");
  });

  it("rejects empty string externalAccountId", () => {
    const result = validateAccountForOrderActions(
      makeAccount({ externalAccountId: "" }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NO_EXTERNAL_ACCOUNT_ID");
  });

  it("platform check fires before other checks", () => {
    // Even an inactive archived account on the wrong platform gets UNSUPPORTED_PLATFORM
    const result = validateAccountForOrderActions(
      makeAccount({ platform: "manual", isActive: false, protectionStatus: "archived" }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "UNSUPPORTED_PLATFORM");
  });
});

// ── canSendLiveOrderActions ────────────────────────────────────────────────────

describe("canSendLiveOrderActions", () => {
  it("returns true for full_access", () => {
    assert.equal(canSendLiveOrderActions({ permissionLevel: "full_access" }), true);
  });

  it("returns false for read_only", () => {
    assert.equal(canSendLiveOrderActions({ permissionLevel: "read_only" }), false);
  });

  it("returns true for null (not yet probed — treated optimistically)", () => {
    assert.equal(canSendLiveOrderActions({ permissionLevel: null }), true);
  });

  it("returns true for unknown/future permission level values", () => {
    assert.equal(canSendLiveOrderActions({ permissionLevel: "some_future_level" }), true);
  });
});
