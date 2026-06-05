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
const routeRaw = readFileSync(
  resolve(ROOT, "app/api/accounts/[id]/lockout/route.ts"),
  "utf8",
);
/** Executable code only — block comments and line comments stripped so
 *  negative assertions don't fire on explanatory JSDoc text. */
const route = routeRaw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
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

  it("emergency lockout: cancels orders + flattens via the account-scoped helpers, never raw order placement", () => {
    // The emergency lockout DOES cancel orders and flatten positions, but only
    // through the safe, account-scoped wrappers — never raw order placement and
    // never a direct liquidate call from the route.
    assert.ok(
      route.includes("cancelOpenOrdersForAccount"),
      "route must cancel working orders via the account-scoped helper",
    );
    assert.ok(
      route.includes("flattenPositionsForAccount"),
      "route must flatten positions via the account-scoped helper",
    );
    for (const path of ["placeOrder", "liquidatepositions", "order/cancelorder"]) {
      assert.ok(!route.includes(path), `route must not call raw broker order path: ${path}`);
    }
    // The internal-lock payload helper must stay free of any order paths.
    for (const path of ["cancelOrder", "flattenPositions", "placeOrder", "liquidatepositions"]) {
      assert.ok(!helper.includes(path), `helper must not reference order path: ${path}`);
    }
  });

  it("does not write the broker risk setting directly — delegates to the shared service", () => {
    // The route must not instantiate the Tradovate client or call the
    // userAccountAutoLiq write itself; that lives in the reused broker module
    // behind the manual broker-lock service.
    for (const path of ["userAccountAutoLiq", "new TradovateClient", "applyDailyLossLock"]) {
      assert.ok(!route.includes(path), `route must delegate the broker write, not call ${path} directly`);
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

describe("POST /api/accounts/[id]/lockout — broker-level lock attempt", () => {
  it("attempts the broker lock via the shared manual broker-lock service", () => {
    assert.ok(
      route.includes("maybeAttemptBrokerLockForManualLock"),
      "route must attempt the broker lock via the shared service",
    );
    assert.ok(
      route.includes("manual-broker-lock-service"),
      "route must import the manual broker-lock service",
    );
  });

  it("commits the internal lock BEFORE attempting the broker lock", () => {
    const txnIdx = route.indexOf("prisma.$transaction");
    // Target the call site (with its argument), not the import statement.
    const brokerIdx = route.indexOf("maybeAttemptBrokerLockForManualLock(lockEvent.id)");
    assert.ok(txnIdx > -1 && brokerIdx > -1, "both steps must be present");
    assert.ok(
      txnIdx < brokerIdx,
      "the internal lock transaction must run before the broker attempt",
    );
  });

  it("never rolls back the internal lock when the broker attempt fails (try/catch)", () => {
    // The broker attempt is wrapped so a thrown error is caught and surfaced as
    // a broker status — the already-committed internal lock is preserved.
    assert.ok(/try\s*\{[\s\S]*maybeAttemptBrokerLockForManualLock[\s\S]*\}\s*catch/.test(route),
      "broker attempt must be inside a try/catch so failures don't roll back the internal lock");
    assert.ok(
      !/\.delete\(|\.deleteMany\(/.test(route),
      "route must never delete the internal lock",
    );
  });

  it("surfaces the broker outcome in the response for the UI", () => {
    assert.ok(route.includes("brokerLock"), "response must include the brokerLock outcome");
    assert.ok(
      route.includes("mapManualBrokerLockStatus"),
      "route must map the broker status to the UI state via the pure helper",
    );
  });
});

describe("POST /api/accounts/[id]/lockout — emergency lockout ordering & wiring", () => {
  it("executes the four steps in the approved order: cancel → flatten → internal lock → broker lock", () => {
    const cancelIdx = route.indexOf("cancelOpenOrdersForAccount(account.id");
    const flattenIdx = route.indexOf("flattenPositionsForAccount(account.id");
    const txnIdx = route.indexOf("prisma.$transaction");
    const brokerIdx = route.indexOf("maybeAttemptBrokerLockForManualLock(lockEvent.id)");
    assert.ok(
      cancelIdx > -1 && flattenIdx > -1 && txnIdx > -1 && brokerIdx > -1,
      "all four steps must be present",
    );
    assert.ok(cancelIdx < flattenIdx, "cancel orders must run before flatten");
    assert.ok(flattenIdx < txnIdx, "flatten must run before the internal lock transaction");
    assert.ok(txnIdx < brokerIdx, "internal lock must run before the broker lock");
  });

  it("scopes every broker step to the SELECTED account id (account.id) only", () => {
    assert.ok(
      route.includes("cancelOpenOrdersForAccount(account.id"),
      "cancel must be scoped to the selected account id",
    );
    assert.ok(
      route.includes("flattenPositionsForAccount(account.id"),
      "flatten must be scoped to the selected account id",
    );
  });

  it("tags broker order/flatten audit rows with the emergency_lockout trigger reason", () => {
    assert.ok(
      route.includes('"emergency_lockout"'),
      "cancel/flatten must pass triggerReason: emergency_lockout for the audit trail",
    );
  });

  it("cancel failure does not block flatten (each best-effort in its own try/catch)", () => {
    // Both broker-action steps are wrapped so a throw is recorded and execution
    // continues to the next step and ultimately to the internal lock.
    assert.ok(
      /try\s*\{[\s\S]*cancelOpenOrdersForAccount[\s\S]*\}\s*catch/.test(route),
      "cancel must be in a try/catch so a failure does not abort the request",
    );
    assert.ok(
      /try\s*\{[\s\S]*flattenPositionsForAccount[\s\S]*\}\s*catch/.test(route),
      "flatten must be in a try/catch so a failure does not abort the request",
    );
  });

  it("internal lock is committed unconditionally — outside any cancel/flatten catch", () => {
    // The $transaction must NOT be nested inside the cancel/flatten try blocks;
    // it runs after them regardless of their outcome.
    const flattenCatchIdx = route.indexOf("flatten positions failed");
    const txnIdx = route.indexOf("prisma.$transaction");
    assert.ok(
      flattenCatchIdx > -1 && txnIdx > flattenCatchIdx,
      "the internal lock transaction must come after the flatten try/catch block",
    );
  });

  it("logs the required emergency-lockout lifecycle lines with the target identity", () => {
    for (const line of [
      "[account-lockout] emergency lockout requested",
      "[account-lockout] cancelled working orders",
      "[account-lockout] flattened positions",
      "[account-lockout] manual internal lock applied",
      "[account-lockout] broker lock result",
    ]) {
      assert.ok(route.includes(line), `route must log: ${line}`);
    }
  });

  it("pre-write log includes accountId, label, externalAccountId, brokerConnectionId, env, permissionLevel", () => {
    const reqIdx = route.indexOf("[account-lockout] emergency lockout requested");
    const slice = route.slice(reqIdx, reqIdx + 600);
    for (const field of [
      "label:",
      "externalAccountId:",
      "brokerConnectionId:",
      "env:",
      "permissionLevel:",
    ]) {
      assert.ok(slice.includes(field), `pre-write log must include ${field}`);
    }
  });

  it("surfaces order-actions-enabled state so dry-run is never reported as success", () => {
    assert.ok(
      route.includes("isTradovateOrderActionsEnabled"),
      "route must read the order-actions flag to report dry-run honestly",
    );
    assert.ok(
      route.includes("orderActionsEnabled"),
      "response must expose orderActionsEnabled for the UI",
    );
  });

  it("returns per-step results for the UI (cancelOrders, flattenPositions, internalLock, brokerLock)", () => {
    assert.ok(route.includes("cancelOrders"), "response must include cancelOrders result");
    assert.ok(route.includes("flattenPositions"), "response must include flattenPositions result");
    assert.ok(route.includes("internalLock"), "response must include internalLock result");
    assert.ok(route.includes("brokerLock"), "response must include brokerLock result");
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
