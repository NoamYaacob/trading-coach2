/**
 * Contract tests for POST /api/accounts/[id]/lockout
 *
 * Source-scan approach for the route's security wiring and broker-isolation
 * guarantees. The lock's value-producing logic (dedup key, CME day, STOPPED
 * state, internal-only flags) lives in lockout-helpers.ts and is exercised
 * functionally in lockout-helpers.test.ts.
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
const helper = readFileSync(
  resolve(ROOT, "app/api/accounts/[id]/lockout/lockout-helpers.ts"),
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
    for (const path of ["tradovate", "cancelOrder", "flattenPositions", "userAccountAutoLiq", "placeOrder"]) {
      assert.ok(!route.includes(path), `route must not reference broker write path: ${path}`);
      assert.ok(!helper.includes(path), `helper must not reference broker write path: ${path}`);
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

  it("only mutates LiveSessionState + InternalLockEvent, both via upsert (no delete)", () => {
    assert.ok(!/\.delete\(|\.deleteMany\(/.test(route), "route must not delete anything");
    assert.ok(route.includes("liveSessionState.upsert"), "must upsert LiveSessionState");
    assert.ok(route.includes("internalLockEvent.upsert"), "must upsert InternalLockEvent");
  });
});

describe("POST /api/accounts/[id]/lockout — lock mechanics (route wiring)", () => {
  it("delegates payload construction to buildManualLockoutPlan", () => {
    assert.ok(
      route.includes("buildManualLockoutPlan"),
      "route must build its payloads via the testable helper",
    );
  });

  it("wraps liveSessionState + internalLockEvent in a single prisma.$transaction", () => {
    assert.ok(
      route.includes("prisma.$transaction"),
      "lock must be atomic — both upserts in one transaction",
    );
  });

  it("uses the plan's activeDedupKey as the upsert conflict target", () => {
    assert.ok(
      route.includes("activeDedupKey: plan.activeDedupKey"),
      "internalLockEvent upsert must key on the plan's activeDedupKey for idempotency",
    );
  });

  it("returns ok:true + status:locked + tradingDay on success", () => {
    assert.ok(route.includes("ok: true"), "success response must include ok: true");
    assert.ok(route.includes('"locked"'), "success response must include status: 'locked'");
    assert.ok(route.includes("tradingDay: plan.tradingDay"), "must echo the CME trading day");
  });
});

describe("lockout-helpers — sourced from canonical helpers", () => {
  it("builds the dedup key via buildInternalLockDedupKey", () => {
    assert.ok(
      helper.includes("buildInternalLockDedupKey"),
      "helper must build the dedup key via the shared internal-lock helper",
    );
    assert.ok(
      evaluator.includes("buildInternalLockDedupKey"),
      "buildInternalLockDedupKey must be exported from internal-lock-evaluator.ts",
    );
  });

  it("scopes the day via deriveCmeTradingDayKey", () => {
    assert.ok(
      helper.includes("deriveCmeTradingDayKey"),
      "helper must scope the lock to the CME session via deriveCmeTradingDayKey()",
    );
    assert.ok(
      tradingDay.includes("deriveCmeTradingDayKey"),
      "deriveCmeTradingDayKey must be exported from trading-day.ts",
    );
  });

  it("uses ruleType manual_lock (no schema migration needed)", () => {
    assert.ok(
      helper.includes('"manual_lock"'),
      "InternalLockEvent must use ruleType='manual_lock'",
    );
  });

  it("sets riskState STOPPED + internalOnly true + brokerActionTaken false", () => {
    assert.ok(helper.includes('riskState: "STOPPED"'), "must set riskState STOPPED");
    assert.ok(helper.includes("internalOnly: true"), "must set internalOnly true");
    assert.ok(helper.includes("brokerActionTaken: false"), "must set brokerActionTaken false");
  });
});
