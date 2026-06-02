/**
 * Functional unit tests for the manual-lockout plan builder.
 *
 * Unlike the source-scan contract tests in lockout.test.ts, these execute the
 * real buildManualLockoutPlan logic and assert the values it produces — the
 * critical lockout invariants: same-day dedup, per-account isolation, CME-day
 * scoping (not UTC/local), STOPPED risk state, and internal-only (no broker).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildManualLockoutPlan,
  MANUAL_LOCK_RULE_TYPE,
} from "./lockout-helpers.ts";
import { deriveCmeTradingDayKey } from "../../../../../lib/trading-day.ts";

describe("buildManualLockoutPlan — dedup / idempotency", () => {
  it("repeated calls for the same account+session produce the SAME dedup key", () => {
    const now = new Date("2026-05-15T20:00:00Z");
    const a = buildManualLockoutPlan({ accountId: "acc1", userId: "u1", now });
    const b = buildManualLockoutPlan({ accountId: "acc1", userId: "u1", now });
    assert.equal(a.activeDedupKey, b.activeDedupKey);
    // Same key → DB unique constraint turns repeated clicks into an idempotent
    // upsert (update), never a second active lock row.
  });

  it("dedup key is exactly accountId:manual_lock:tradingDay:internal_lock", () => {
    const now = new Date("2026-05-15T20:00:00Z");
    const plan = buildManualLockoutPlan({ accountId: "acc1", userId: "u1", now });
    assert.equal(
      plan.activeDedupKey,
      `acc1:manual_lock:${plan.tradingDay}:internal_lock`,
    );
  });

  it("uses ruleType 'manual_lock' (distinct from rule-engine rule types)", () => {
    assert.equal(MANUAL_LOCK_RULE_TYPE, "manual_lock");
    const plan = buildManualLockoutPlan({ accountId: "acc1", userId: "u1" });
    assert.equal(plan.internalLockEvent.create.ruleType, "manual_lock");
    assert.ok(
      plan.activeDedupKey.includes(":manual_lock:"),
      "dedup key must carry the manual_lock ruleType so it never collides with daily_loss_limit / trade_limit / max_loss_streak",
    );
  });
});

describe("buildManualLockoutPlan — per-account isolation", () => {
  it("different accounts get different dedup keys (one account's lock cannot touch another)", () => {
    const now = new Date("2026-05-15T20:00:00Z");
    const a = buildManualLockoutPlan({ accountId: "acc1", userId: "u1", now });
    const b = buildManualLockoutPlan({ accountId: "acc2", userId: "u1", now });
    assert.notEqual(a.activeDedupKey, b.activeDedupKey);
  });

  it("the lock payload only ever names the target account", () => {
    const plan = buildManualLockoutPlan({ accountId: "acc1", userId: "u1" });
    assert.equal(plan.liveSessionState.create.accountId, "acc1");
    assert.equal(plan.internalLockEvent.create.accountId, "acc1");
    // No other account id appears in the plan — scope is a single account.
    assert.ok(plan.activeDedupKey.startsWith("acc1:"));
  });
});

describe("buildManualLockoutPlan — CME trading day (not UTC/local)", () => {
  it("tradingDay matches the canonical CME-day helper for the same instant", () => {
    const now = new Date("2026-05-15T20:00:00Z");
    const plan = buildManualLockoutPlan({ accountId: "acc1", userId: "u1", now });
    assert.equal(plan.tradingDay, deriveCmeTradingDayKey(now));
  });

  it("after midnight UTC but before 17:00 CT rollover → still the prior CME day", () => {
    // 2026-05-06 04:00 UTC = 2026-05-05 23:00 CDT. The UTC calendar day is the
    // 6th, but the CME session opened 2026-05-05 17:00 CT → key must be 05-05.
    const now = new Date("2026-05-06T04:00:00Z");
    const plan = buildManualLockoutPlan({ accountId: "acc1", userId: "u1", now });
    assert.equal(plan.tradingDay, "2026-05-05");
    assert.notEqual(plan.tradingDay, "2026-05-06"); // proves it is NOT the UTC day
  });

  it("before 17:00 CT → maps to the previous session's CME day", () => {
    // 2026-05-05 21:00 UTC = 16:00 CDT, before the 17:00 CT open → prior day.
    const now = new Date("2026-05-05T21:00:00Z");
    const plan = buildManualLockoutPlan({ accountId: "acc1", userId: "u1", now });
    assert.equal(plan.tradingDay, "2026-05-04");
  });

  it("at/after 17:00 CT → maps to that session's CME day", () => {
    // 2026-05-05 23:00 UTC = 18:00 CDT, after the 17:00 CT open → same CME day.
    const now = new Date("2026-05-05T23:00:00Z");
    const plan = buildManualLockoutPlan({ accountId: "acc1", userId: "u1", now });
    assert.equal(plan.tradingDay, "2026-05-05");
  });

  it("sessionDate on the LiveSessionState create equals the CME trading day", () => {
    const now = new Date("2026-05-15T20:00:00Z");
    const plan = buildManualLockoutPlan({ accountId: "acc1", userId: "u1", now });
    assert.equal(plan.liveSessionState.create.sessionDate, plan.tradingDay);
    assert.equal(plan.internalLockEvent.create.tradingDay, plan.tradingDay);
  });

  it("two clicks in the same CME session (different wall-clock minutes) dedup to one lock", () => {
    const click1 = new Date("2026-05-05T23:00:00Z"); // 18:00 CDT
    const click2 = new Date("2026-05-06T05:30:00Z"); // 00:30 CDT next UTC day, same CME session
    const a = buildManualLockoutPlan({ accountId: "acc1", userId: "u1", now: click1 });
    const b = buildManualLockoutPlan({ accountId: "acc1", userId: "u1", now: click2 });
    assert.equal(a.tradingDay, "2026-05-05");
    assert.equal(b.tradingDay, "2026-05-05");
    assert.equal(a.activeDedupKey, b.activeDedupKey); // same active lock slot
  });
});

describe("buildManualLockoutPlan — locks internally, never the broker", () => {
  it("sets riskState STOPPED on both create and update", () => {
    const plan = buildManualLockoutPlan({ accountId: "acc1", userId: "u1" });
    assert.equal(plan.liveSessionState.create.riskState, "STOPPED");
    assert.equal(plan.liveSessionState.update.riskState, "STOPPED");
  });

  it("marks the lock internalOnly with no broker action taken", () => {
    const plan = buildManualLockoutPlan({ accountId: "acc1", userId: "u1" });
    assert.equal(plan.internalLockEvent.create.internalOnly, true);
    assert.equal(plan.internalLockEvent.create.brokerActionTaken, false);
  });

  it("carries the requesting user id onto the lock event (ownership audit)", () => {
    const plan = buildManualLockoutPlan({ accountId: "acc1", userId: "owner-7" });
    assert.equal(plan.internalLockEvent.create.userId, "owner-7");
  });

  it("update path only refreshes updatedAt — never reopens or downgrades the lock", () => {
    const plan = buildManualLockoutPlan({ accountId: "acc1", userId: "u1" });
    assert.deepEqual(Object.keys(plan.internalLockEvent.update), ["updatedAt"]);
    assert.ok(plan.internalLockEvent.update.updatedAt instanceof Date);
  });
});
