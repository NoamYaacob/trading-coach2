/**
 * Contract tests for DELETE /api/broker-connections/[id].
 *
 * Guards the safety invariants introduced to fix the UI/API mismatch where
 * the UI showed "0 linked accounts" for a connection with archived accounts
 * but the DELETE returned 409 "has_linked_accounts".
 *
 * Root cause: the old guard counted ALL isActive accounts (including
 * archived), but the settings page didn't load archived accounts, so the UI
 * couldn't show them or let the user unblock the deletion.
 *
 * Fix: the guard blocks only on non-archived active accounts. Archived active
 * accounts are unlinked (brokerConnectionId → null) in a transaction before
 * the connection row is deleted, preserving all historical data.
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTE_FILE = resolve(import.meta.dirname, "route.ts");

function src(): string {
  return readFileSync(ROUTE_FILE, "utf8");
}

// ── Guard: blocks only on non-archived active accounts ────────────────────────

describe("DELETE broker connection — guard condition", () => {
  test("block condition filters protectionStatus not archived", () => {
    assert.ok(
      src().includes('protectionStatus: { not: "archived" }'),
      'route must count only non-archived accounts: protectionStatus: { not: "archived" }',
    );
  });

  test("error message says 'Remove linked accounts first'", () => {
    assert.ok(
      src().includes("Remove linked accounts first"),
      "route must return 'Remove linked accounts first' message, not the old generic message",
    );
  });

  test("old message 'Cannot remove a connection with linked accounts.' is replaced", () => {
    assert.ok(
      !src().includes("Cannot remove a connection with linked accounts."),
      "old blocking message must be removed — the new message guides the user",
    );
  });
});

// ── Safe unlink of archived accounts before delete ────────────────────────────

describe("DELETE broker connection — archived account unlink", () => {
  test("route nullifies brokerConnectionId on archived accounts before deleting", () => {
    assert.ok(
      src().includes("brokerConnectionId: null"),
      "route must set brokerConnectionId: null on archived accounts before deletion",
    );
  });

  test("route uses updateMany to unlink archived accounts", () => {
    assert.ok(
      src().includes("connectedAccount.updateMany"),
      "route must call connectedAccount.updateMany to unlink archived rows",
    );
  });

  test("route wraps unlink+delete in a $transaction", () => {
    assert.ok(
      src().includes("$transaction"),
      "route must wrap updateMany + delete in a $transaction for atomicity",
    );
  });
});

// ── Historical data preservation ──────────────────────────────────────────────

describe("DELETE broker connection — never deletes historical tables", () => {
  const FORBIDDEN = [
    "normalizedTradeEvent",
    "accountRiskRules",
    "internalLockEvent",
    "guardianStatus",
    "brokerOrderActionLog",
    "ruleChangeAudit",
  ];

  for (const table of FORBIDDEN) {
    test(`route does not delete or deleteMany from ${table}`, () => {
      const stripped = src()
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      assert.ok(
        !new RegExp(`${table}\\.delete`).test(stripped),
        `route must not call ${table}.delete or ${table}.deleteMany`,
      );
    });
  }
});

// ── Auth ──────────────────────────────────────────────────────────────────────

describe("DELETE broker connection — auth", () => {
  test("route calls getCurrentUser and rejects unauthenticated requests", () => {
    assert.ok(
      src().includes("getCurrentUser"),
      "route must call getCurrentUser",
    );
    assert.ok(
      src().includes("status: 401"),
      "route must return 401 for unauthenticated requests",
    );
  });

  test("route scopes connection lookup to currentUser.id", () => {
    assert.ok(
      src().includes("userId: currentUser.id"),
      "route must scope the BrokerConnection lookup to the authenticated user",
    );
  });
});
