import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  validateAccountForOrderActions,
  canSendLiveOrderActions,
  parseTradovateAccountId,
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

// ── parseTradovateAccountId ───────────────────────────────────────────────────
//
// Safety invariant: both cancelOpenOrdersForAccount and flattenPositionsForAccount
// call parseTradovateAccountId BEFORE client.initialize() and BEFORE any broker
// API call. If this helper returns ok:false the action functions throw immediately,
// so getOrders() and applyFlattenOpenPositions() are never reached.

describe("parseTradovateAccountId", () => {
  // ── Valid inputs ────────────────────────────────────────────────────────────

  it("returns ok:true with numeric tvAccountId for a normal account ID", () => {
    const result = parseTradovateAccountId("1234567");
    assert.deepEqual(result, { ok: true, tvAccountId: 1234567 });
  });

  it("returns ok:true for a single-digit positive ID", () => {
    const result = parseTradovateAccountId("1");
    assert.deepEqual(result, { ok: true, tvAccountId: 1 });
  });

  it("returns ok:true for a large account ID", () => {
    const result = parseTradovateAccountId("99999999");
    assert.deepEqual(result, { ok: true, tvAccountId: 99999999 });
  });

  // ── Invalid: null / empty ───────────────────────────────────────────────────

  it("rejects null — blocks cancel and flatten before any API call", () => {
    const result = parseTradovateAccountId(null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_EXTERNAL_ACCOUNT_ID");
  });

  it("rejects empty string", () => {
    const result = parseTradovateAccountId("");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_EXTERNAL_ACCOUNT_ID");
  });

  // ── Invalid: non-integer strings (the safety gap this hardens) ─────────────

  it("rejects alphabetic string — blocks cancel before getOrders() is called", () => {
    const result = parseTradovateAccountId("abc");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_EXTERNAL_ACCOUNT_ID");
  });

  it("rejects alphanumeric string — blocks flatten before applyFlattenOpenPositions()", () => {
    const result = parseTradovateAccountId("123abc");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_EXTERNAL_ACCOUNT_ID");
  });

  it("rejects leading alphabetic with digits", () => {
    const result = parseTradovateAccountId("abc123");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_EXTERNAL_ACCOUNT_ID");
  });

  it("rejects decimal notation — parseInt would silently truncate", () => {
    const result = parseTradovateAccountId("123.0");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_EXTERNAL_ACCOUNT_ID");
  });

  it("rejects string with spaces — parseInt would silently ignore leading spaces", () => {
    const result = parseTradovateAccountId(" 123");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_EXTERNAL_ACCOUNT_ID");
  });

  it("rejects trailing spaces", () => {
    const result = parseTradovateAccountId("123 ");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_EXTERNAL_ACCOUNT_ID");
  });

  it("rejects explicit positive sign — parseInt accepts it, digits-only regex does not", () => {
    const result = parseTradovateAccountId("+123");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_EXTERNAL_ACCOUNT_ID");
  });

  it("rejects negative sign — parseInt would return a negative number", () => {
    const result = parseTradovateAccountId("-123");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_EXTERNAL_ACCOUNT_ID");
  });

  it("rejects hex notation — parseInt with base 10 would silently stop at 'x'", () => {
    const result = parseTradovateAccountId("0x1A");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_EXTERNAL_ACCOUNT_ID");
  });

  // ── Invalid: zero ──────────────────────────────────────────────────────────

  it("rejects '0' — Tradovate account IDs are positive", () => {
    const result = parseTradovateAccountId("0");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_EXTERNAL_ACCOUNT_ID");
  });

  it("rejects '00' — leading zeros that parse to zero", () => {
    const result = parseTradovateAccountId("00");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_EXTERNAL_ACCOUNT_ID");
  });
});
