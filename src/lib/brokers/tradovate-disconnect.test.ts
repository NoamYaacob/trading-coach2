/**
 * Unit tests for broker disconnect helpers.
 *
 * These test the pure payload-builder, cleanup-decision, and error-classification
 * helpers. No DB, no network, no credentials required.
 *
 * API-level authorization tests (unauthenticated reject, wrong-owner reject,
 * do-not-delete-journal) require a database and belong in integration tests.
 * The authorization logic they cover lives in DELETE /api/accounts/[id]:
 *   - getCurrentUser() check → 401 when unauthenticated
 *   - findFirst({ where: { id, userId: currentUser.id } }) → 404 for wrong owner
 *   - update only sets isActive/connectionStatus/token fields, never touches
 *     ManualTradeEntry, RiskRules, DailySessionEvent, GuardianStatus
 *
 * Run:  npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildDisconnectUpdate,
  buildNoRevocationResult,
  buildSkippedCleanupResult,
  buildSucceededCleanupResult,
  buildFailedCleanupResult,
  classifyBrokerCleanupError,
  platformHasRevocationEndpoint,
  shouldAttemptBrokerCleanup,
  BROKER_CLEANUP_WARNING,
} from "./tradovate-disconnect.ts";
import { TradovateClientError } from "./tradovate-client-helpers.ts";

// ── buildDisconnectUpdate ─────────────────────────────────────────────────────

describe("buildDisconnectUpdate", () => {
  it("marks account inactive", () => {
    const update = buildDisconnectUpdate();
    assert.equal(update.isActive, false);
  });

  it("sets connectionStatus to not_connected", () => {
    const update = buildDisconnectUpdate();
    assert.equal(update.connectionStatus, "not_connected");
  });

  it("clears accessTokenEncrypted to null", () => {
    const update = buildDisconnectUpdate();
    assert.equal(update.accessTokenEncrypted, null);
  });

  it("clears refreshTokenEncrypted to null", () => {
    const update = buildDisconnectUpdate();
    assert.equal(update.refreshTokenEncrypted, null);
  });

  it("clears tokenExpiresAt to null", () => {
    const update = buildDisconnectUpdate();
    assert.equal(update.tokenExpiresAt, null);
  });

  it("sets a non-empty errorMessage", () => {
    const update = buildDisconnectUpdate();
    assert.ok(typeof update.errorMessage === "string" && update.errorMessage.length > 0);
  });

  it("returns a consistent shape on every call (idempotent)", () => {
    const a = buildDisconnectUpdate();
    const b = buildDisconnectUpdate();
    assert.deepEqual(a, b);
  });

  it("disconnected account has isActive=false — sync and enforcement are disabled", () => {
    // isActive=false prevents the account from appearing in sync queries and
    // from being picked up by the enforcement engine.
    const update = buildDisconnectUpdate();
    assert.equal(update.isActive, false);
  });

  it("disconnected account has connectionStatus=not_connected — no broker enforcement", () => {
    // deriveEnforcementMode returns 'not_connected' for this status, so no
    // broker-side enforcement actions can fire after disconnect.
    const update = buildDisconnectUpdate();
    assert.equal(update.connectionStatus, "not_connected");
  });
});

// ── shouldAttemptBrokerCleanup ────────────────────────────────────────────────

describe("shouldAttemptBrokerCleanup", () => {
  it("returns true for active Tradovate account with externalAccountId", () => {
    assert.equal(
      shouldAttemptBrokerCleanup({
        platform: "tradovate",
        externalAccountId: "12345",
        isActive: true,
      }),
      true,
    );
  });

  it("returns false when platform is not tradovate", () => {
    assert.equal(
      shouldAttemptBrokerCleanup({
        platform: "tradingview",
        externalAccountId: "12345",
        isActive: true,
      }),
      false,
    );
  });

  it("returns false when externalAccountId is null (account ID never resolved)", () => {
    assert.equal(
      shouldAttemptBrokerCleanup({
        platform: "tradovate",
        externalAccountId: null,
        isActive: true,
      }),
      false,
    );
  });

  it("returns false when externalAccountId is empty string", () => {
    assert.equal(
      shouldAttemptBrokerCleanup({
        platform: "tradovate",
        externalAccountId: "  ",
        isActive: true,
      }),
      false,
    );
  });

  it("returns false when account is inactive — no live broker rules to clean up", () => {
    // An inactive account has no active Guardrail broker enforcement,
    // so calling the position-limit deactivation endpoint is a no-op at best.
    assert.equal(
      shouldAttemptBrokerCleanup({
        platform: "tradovate",
        externalAccountId: "12345",
        isActive: false,
      }),
      false,
    );
  });

  it("returns false for manual platform", () => {
    assert.equal(
      shouldAttemptBrokerCleanup({
        platform: "manual",
        externalAccountId: "12345",
        isActive: true,
      }),
      false,
    );
  });
});

// ── classifyBrokerCleanupError ────────────────────────────────────────────────

describe("classifyBrokerCleanupError", () => {
  it("classifies NO_TOKENS as token_invalid", () => {
    const err = new TradovateClientError("NO_TOKENS", "no tokens");
    assert.equal(classifyBrokerCleanupError(err), "token_invalid");
  });

  it("classifies TOKEN_LOAD_FAILED as token_invalid", () => {
    const err = new TradovateClientError("TOKEN_LOAD_FAILED", "load failed");
    assert.equal(classifyBrokerCleanupError(err), "token_invalid");
  });

  it("classifies TOKEN_EXPIRED_NO_REFRESH as token_invalid", () => {
    const err = new TradovateClientError("TOKEN_EXPIRED_NO_REFRESH", "expired");
    assert.equal(classifyBrokerCleanupError(err), "token_invalid");
  });

  it("classifies REFRESH_FAILED as token_invalid", () => {
    const err = new TradovateClientError("REFRESH_FAILED", "refresh failed");
    assert.equal(classifyBrokerCleanupError(err), "token_invalid");
  });

  it("classifies API_ERROR 401 as scope_gap", () => {
    const err = new TradovateClientError("API_ERROR", "unauthorized", 401);
    assert.equal(classifyBrokerCleanupError(err), "scope_gap");
  });

  it("classifies API_ERROR 403 as scope_gap", () => {
    const err = new TradovateClientError("API_ERROR", "forbidden", 403);
    assert.equal(classifyBrokerCleanupError(err), "scope_gap");
  });

  it("classifies API_ERROR 500 as other (transient)", () => {
    const err = new TradovateClientError("API_ERROR", "server error", 500);
    assert.equal(classifyBrokerCleanupError(err), "other");
  });

  it("classifies NETWORK_ERROR as other", () => {
    const err = new TradovateClientError("NETWORK_ERROR", "network error");
    assert.equal(classifyBrokerCleanupError(err), "other");
  });

  it("classifies unknown Error as other", () => {
    assert.equal(classifyBrokerCleanupError(new Error("unknown")), "other");
  });

  it("classifies non-Error as other", () => {
    assert.equal(classifyBrokerCleanupError("string error"), "other");
    assert.equal(classifyBrokerCleanupError(null), "other");
  });
});

// ── buildSkippedCleanupResult ─────────────────────────────────────────────────

describe("buildSkippedCleanupResult", () => {
  it("marks cleanup as not attempted with no warning", () => {
    const result = buildSkippedCleanupResult();
    assert.equal(result.attempted, false);
    assert.equal(result.succeeded, false);
    assert.equal(result.warning, null);
  });

  it("is used when shouldAttemptBrokerCleanup returns false (not Tradovate, etc.)", () => {
    // No warning shown to user when cleanup was never applicable.
    const result = buildSkippedCleanupResult();
    assert.equal(result.warning, null);
  });
});

// ── buildSucceededCleanupResult ───────────────────────────────────────────────

describe("buildSucceededCleanupResult", () => {
  it("marks cleanup as attempted and succeeded with no warning", () => {
    const result = buildSucceededCleanupResult();
    assert.equal(result.attempted, true);
    assert.equal(result.succeeded, true);
    assert.equal(result.warning, null);
  });
});

// ── buildFailedCleanupResult ──────────────────────────────────────────────────

describe("buildFailedCleanupResult", () => {
  it("marks cleanup as attempted and failed with a warning for token_invalid errors", () => {
    const err = new TradovateClientError("TOKEN_EXPIRED_NO_REFRESH", "expired");
    const result = buildFailedCleanupResult(err);
    assert.equal(result.attempted, true);
    assert.equal(result.succeeded, false);
    assert.equal(result.warning, BROKER_CLEANUP_WARNING);
  });

  it("marks cleanup as attempted and failed with a warning for scope_gap errors", () => {
    const err = new TradovateClientError("API_ERROR", "forbidden", 403);
    const result = buildFailedCleanupResult(err);
    assert.equal(result.attempted, true);
    assert.equal(result.succeeded, false);
    assert.equal(result.warning, BROKER_CLEANUP_WARNING);
  });

  it("marks cleanup as attempted and failed with a warning for unknown errors", () => {
    const result = buildFailedCleanupResult(new Error("unexpected"));
    assert.equal(result.attempted, true);
    assert.equal(result.succeeded, false);
    assert.ok(typeof result.warning === "string" && result.warning.length > 0);
  });

  it("warning references Tradovate Risk Settings so the user knows what to check", () => {
    const result = buildFailedCleanupResult(new TradovateClientError("NO_TOKENS", "no tokens"));
    assert.ok(result.warning?.includes("Tradovate Risk Settings"));
  });

  it("never crashes regardless of error type", () => {
    // Must not throw for any input — failure is non-fatal.
    assert.doesNotThrow(() => buildFailedCleanupResult(null));
    assert.doesNotThrow(() => buildFailedCleanupResult(undefined));
    assert.doesNotThrow(() => buildFailedCleanupResult("string"));
    assert.doesNotThrow(() => buildFailedCleanupResult({ code: "weird" }));
  });
});

// ── Disconnect does not touch user/prop-firm risk settings ────────────────────
// (structural guarantee — documented here for clarity)

describe("disconnect does not touch user/prop-firm risk settings", () => {
  it("buildDisconnectUpdate payload contains no risk-rules fields", () => {
    const update = buildDisconnectUpdate();
    const keys = Object.keys(update);
    // These fields must never appear in the disconnect payload.
    const forbidden = ["riskRules", "maxDailyLoss", "propFirmDailyLossLimit", "maxContracts"];
    for (const field of forbidden) {
      assert.ok(!keys.includes(field), `disconnect payload must not include '${field}'`);
    }
  });

  it("shouldAttemptBrokerCleanup only gates Tradovate position-limit cleanup, not rule deletion", () => {
    // The cleanup path (applyMaxPositionSize with null) deactivates only the
    // Guardrail-owned UserAccountPositionLimit (description = GUARDRAIL_POSITION_LIMIT_DESCRIPTION).
    // It never modifies user- or prop-firm-created limits (different description).
    // This test documents the contract rather than the implementation detail.
    const result = shouldAttemptBrokerCleanup({
      platform: "tradovate",
      externalAccountId: "12345",
      isActive: true,
    });
    assert.equal(result, true, "cleanup is attempted for active Tradovate accounts");
    // The cleanup itself uses findGuardrailPositionLimit() which filters by description.
    // That is tested in tradovate-position-limit.test.ts.
  });
});

// ── platformHasRevocationEndpoint ────────────────────────────────────────────

describe("platformHasRevocationEndpoint", () => {
  it("returns false for tradovate — no public revocation endpoint", () => {
    assert.equal(platformHasRevocationEndpoint("tradovate"), false);
  });

  it("returns false for unknown platforms", () => {
    assert.equal(platformHasRevocationEndpoint("some_unknown_broker"), false);
  });

  it("returns false for empty string", () => {
    assert.equal(platformHasRevocationEndpoint(""), false);
  });
});

// ── buildNoRevocationResult ───────────────────────────────────────────────────

describe("buildNoRevocationResult", () => {
  it("marks revocation as not attempted", () => {
    const result = buildNoRevocationResult();
    assert.equal(result.attempted, false);
    assert.equal(result.succeeded, false);
    assert.equal(result.reason, "no_endpoint");
  });
});
