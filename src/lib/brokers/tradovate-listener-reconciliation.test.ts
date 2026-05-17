/**
 * Tests for tradovate-listener-reconciliation.ts
 *
 * Source-scan only — no real DB calls.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(import.meta.dirname, "./tradovate-listener-reconciliation.ts"),
  "utf8",
);

// Strip block comments and line comments before checking for forbidden identifiers
// so that documentation comments (e.g. "No flatten/cancel") don't cause false positives.
const SRC_CODE_ONLY = SRC
  .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
  .replace(/\/\/.*/g, "");           // line comments

describe("tradovate-listener-reconciliation source: safety constraints", () => {
  it("does not contain any broker write actions (flatten/cancel/order)", () => {
    const forbidden = ["flatten", "cancelOrder", "placeOrder", "liquidatePosition"];
    for (const term of forbidden) {
      assert.ok(
        !SRC_CODE_ONLY.includes(term),
        `reconciliation must not reference broker action: ${term}`,
      );
    }
  });

  it("does not call maybeAttemptBrokerDailyLossLockout", () => {
    assert.ok(
      !SRC_CODE_ONLY.includes("maybeAttemptBrokerDailyLossLockout"),
      "reconciliation must not trigger enforcement",
    );
  });

  it("calls syncTradovateAccount (idempotent fill sync)", () => {
    assert.ok(
      SRC.includes("syncTradovateAccount"),
      "reconciliation must call syncTradovateAccount",
    );
  });

  it("imports syncTradovateAccount from tradovate-sync", () => {
    assert.ok(
      SRC.includes("tradovate-sync"),
      "must import sync helper from tradovate-sync",
    );
  });

  it("exports reconcileConnectionAccounts and writeReconciliationResult", () => {
    assert.ok(
      SRC.includes("export async function reconcileConnectionAccounts"),
      "must export reconcileConnectionAccounts",
    );
    assert.ok(
      SRC.includes("export async function writeReconciliationResult"),
      "must export writeReconciliationResult",
    );
  });

  it("returns 'skipped' when no active accounts (no unnecessary syncTradovateAccount calls)", () => {
    assert.ok(
      SRC.includes('"skipped"'),
      "must return skipped status when no accounts to reconcile",
    );
    assert.ok(
      SRC.includes("accounts.length === 0"),
      "must short-circuit when account list is empty",
    );
  });

  it("returns 'failed' only when ALL accounts fail (partial success → 'success')", () => {
    assert.ok(
      SRC.includes("errors.length === accounts.length"),
      "must only return failed when every account failed",
    );
    assert.ok(
      SRC.includes('"success"'),
      "must return success on partial success",
    );
  });

  it("truncates error list to first 3 to avoid DB field overflow", () => {
    assert.ok(
      SRC.includes("slice(0, 3)"),
      "must truncate errors to first 3",
    );
  });

  it("writes trigger type to DB ('initial_connect' | 'reconnect')", () => {
    assert.ok(
      SRC.includes('"initial_connect"') || SRC.includes("initial_connect"),
      "must reference initial_connect trigger type",
    );
    assert.ok(
      SRC.includes('"reconnect"') || SRC.includes("reconnect"),
      "must reference reconnect trigger type",
    );
  });

  it("writes lastReconciliationAt timestamp", () => {
    assert.ok(
      SRC.includes("lastReconciliationAt"),
      "must persist lastReconciliationAt",
    );
  });

  it("updates BrokerConnection row (not any other table)", () => {
    assert.ok(
      SRC.includes("brokerConnection.update"),
      "must update BrokerConnection row",
    );
    const forbidden = ["connectedAccount.update", "normalizedTradeEvent", "accountLock"];
    for (const term of forbidden) {
      assert.ok(
        !SRC.includes(term),
        `writeReconciliationResult must not touch ${term}`,
      );
    }
  });
});
