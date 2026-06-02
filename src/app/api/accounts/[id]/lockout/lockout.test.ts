/**
 * Contract tests for POST /api/accounts/[id]/lockout
 *
 * Source-scan approach — verifies the route's security and behavioral
 * invariants without spinning up a server or requiring a live database.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd(), "src");
const route = readFileSync(
  resolve(ROOT, "app/api/accounts/[id]/lockout/route.ts"),
  "utf8",
);
const evaluator = readFileSync(
  resolve(ROOT, "lib/guardian-engine/internal-lock-evaluator.ts"),
  "utf8",
);
const tradingDay = readFileSync(resolve(ROOT, "lib/trading-day.ts"), "utf8");

describe("POST /api/accounts/[id]/lockout — security", () => {
  it("requires authentication via getCurrentUser()", () => {
    assert.ok(route.includes("getCurrentUser"), "must call getCurrentUser()");
    assert.ok(route.includes('"unauthorized"'), "must return 401 when user is absent");
  });

  it("enforces per-user rate limit", () => {
    assert.ok(route.includes("checkRateLimit"), "must call checkRateLimit");
    assert.ok(
      route.includes("account_lockout:${user.id}"),
      "rate-limit key must be scoped to the user",
    );
    assert.ok(route.includes('"too_many_requests"'), "must return 429 on limit exceeded");
  });

  it("ownership check — only the account owner can lock", () => {
    assert.ok(
      route.includes("userId: user.id"),
      "findFirst must filter by userId: user.id to prevent cross-user access",
    );
  });

  it("only active protected/monitor_only accounts can be locked", () => {
    assert.ok(
      route.includes("isActive: true"),
      "must check isActive: true so archived or inactive accounts cannot be locked",
    );
    assert.ok(
      route.includes('"protected"') && route.includes('"monitor_only"'),
      "must accept only protected or monitor_only protectionStatus",
    );
  });

  it("returns 404 when account not found or not owned by user", () => {
    assert.ok(route.includes('"not_found"'), "must return 404 for missing/unauthorized account");
  });

  it("does not call Tradovate broker write paths", () => {
    for (const path of ["/api/tradovate", "tradovate", "cancelOrder", "flattenPosition"]) {
      assert.ok(!route.includes(path), `route must not reference Tradovate API path: ${path}`);
    }
  });

  it("does not delete or modify historical data tables", () => {
    for (const table of [
      "normalizedTradeEvent",
      "accountRiskRules",
      "guardianStatus",
      "brokerOrderActionLog",
      "ruleChangeAudit",
    ]) {
      assert.ok(!route.includes(table), `route must not touch historical table ${table}`);
    }
  });
});

describe("POST /api/accounts/[id]/lockout — lock mechanics", () => {
  it("uses buildInternalLockDedupKey from the canonical helper", () => {
    assert.ok(
      route.includes("buildInternalLockDedupKey"),
      "must build the dedup key via the shared helper",
    );
    assert.ok(
      evaluator.includes("buildInternalLockDedupKey"),
      "helper must be exported from internal-lock-evaluator.ts",
    );
  });

  it("uses deriveCmeTradingDayKey for session-scoped lock", () => {
    assert.ok(
      route.includes("deriveCmeTradingDayKey"),
      "must call deriveCmeTradingDayKey() to scope the lock to the CME session",
    );
    assert.ok(
      tradingDay.includes("deriveCmeTradingDayKey"),
      "deriveCmeTradingDayKey must be exported from trading-day.ts",
    );
  });

  it("uses ruleType manual_lock (no schema migration needed)", () => {
    assert.ok(
      route.includes('"manual_lock"'),
      "InternalLockEvent must use ruleType='manual_lock'",
    );
  });

  it("wraps liveSessionState + internalLockEvent in a prisma.$transaction", () => {
    assert.ok(
      route.includes("prisma.$transaction"),
      "lock must be atomic — liveSessionState and internalLockEvent must be in a transaction",
    );
    assert.ok(
      route.includes("liveSessionState.upsert"),
      "must upsert liveSessionState (account may not have a row yet)",
    );
    assert.ok(
      route.includes("internalLockEvent.upsert"),
      "must upsert internalLockEvent for idempotency",
    );
  });

  it("sets riskState STOPPED on liveSessionState", () => {
    assert.ok(
      route.includes('riskState: "STOPPED"'),
      "liveSessionState must be set to STOPPED to trigger the locked display",
    );
  });

  it("internalLockEvent is marked internalOnly + no broker action", () => {
    assert.ok(
      route.includes("internalOnly: true"),
      "InternalLockEvent.internalOnly must be true",
    );
    assert.ok(
      route.includes("brokerActionTaken: false"),
      "InternalLockEvent.brokerActionTaken must be false",
    );
  });

  it("creates the lock with activeDedupKey set (prevents duplicate active locks)", () => {
    assert.ok(
      route.includes("activeDedupKey"),
      "must set activeDedupKey on InternalLockEvent for the DB unique constraint",
    );
  });

  it("returns ok:true + status:locked on success", () => {
    assert.ok(
      route.includes('"ok": true') || route.includes("ok: true"),
      "success response must include ok: true",
    );
    assert.ok(
      route.includes('"locked"'),
      "success response must include status: 'locked'",
    );
  });
});
