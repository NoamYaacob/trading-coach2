/**
 * Unit tests for broker disconnect helpers.
 *
 * These test the pure payload-builder and revocation-status helpers.
 * No DB, no network, no credentials required.
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
  platformHasRevocationEndpoint,
} from "./tradovate-disconnect.ts";

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
