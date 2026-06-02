/**
 * Contract tests for the manual broker-lock service
 * (maybeAttemptBrokerLockForManualLock).
 *
 * Source-scan approach: the service reads/writes Prisma and calls the broker
 * orchestrator, so it is pinned by source invariants rather than import-and-call.
 * The invariants here are the safety guarantees of the manual lockout:
 *   - idempotent per account + CME trading day (listenerBrokerDedupKey)
 *   - records a full GuardianIntervention audit row (triggerType=manual)
 *   - flips InternalLockEvent.brokerActionTaken ONLY on a confirmed broker lock
 *   - NEVER rolls back / deletes / un-stops the internal lock on broker failure
 *   - does not touch listener-worker code
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd(), "src");
const raw = readFileSync(
  resolve(ROOT, "lib/guardian-engine/manual-broker-lock-service.ts"),
  "utf8",
);
/** Code with comments stripped — negative ("must not reference") assertions
 *  inspect executable code only, not the explanatory doc comments. */
const svc = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("maybeAttemptBrokerLockForManualLock — idempotency", () => {
  it("keys idempotency on the per-account-per-CME-day dedup key", () => {
    assert.ok(
      svc.includes("buildListenerBrokerDedupKey"),
      "must build the per-account/day dedup key",
    );
    assert.ok(
      svc.includes("listenerBrokerDedupKey: dedupKey"),
      "must write the dedup key to GuardianIntervention",
    );
  });

  it("short-circuits when an intervention with the dedup key already exists", () => {
    assert.ok(
      svc.includes("guardianIntervention.findUnique"),
      "must check for an existing intervention before attempting",
    );
    assert.ok(svc.includes('"already_recorded"'), "must return already_recorded on a prior attempt");
  });

  it("tolerates a concurrent insert (P2002) as an idempotent no-op", () => {
    assert.ok(svc.includes('"P2002"'), "must catch the unique-constraint violation");
    assert.ok(
      svc.includes("PrismaClientKnownRequestError"),
      "must detect the Prisma known-request error",
    );
  });
});

describe("maybeAttemptBrokerLockForManualLock — audit + brokerActionTaken", () => {
  it("records a GuardianIntervention with triggerType=manual", () => {
    assert.ok(svc.includes("guardianIntervention.create"), "must write an audit row");
    assert.ok(svc.includes('triggerType: "manual"'), "audit row must be triggerType=manual");
  });

  it("persists the broker endpoint, payload, and raw response for audit", () => {
    assert.ok(svc.includes("brokerEndpoint"), "must persist the broker endpoint");
    assert.ok(svc.includes("brokerPayloadJson"), "must persist the payload");
    assert.ok(svc.includes("brokerResponseJson"), "must persist the raw response");
    assert.ok(svc.includes("internalLockEventId: lockEvent.id"), "must link the InternalLockEvent");
  });

  it("flips brokerActionTaken to true ONLY on a confirmed broker lock", () => {
    assert.ok(
      svc.includes('result.status === "broker_locked"'),
      "brokerActionTaken must be derived from broker_locked",
    );
    assert.ok(
      /if\s*\(brokerActionTaken\)\s*\{[\s\S]*internalLockEvent\.update[\s\S]*brokerActionTaken:\s*true/.test(svc),
      "must update brokerActionTaken=true only when the broker lock is confirmed",
    );
  });
});

describe("maybeAttemptBrokerLockForManualLock — internal lock is never rolled back", () => {
  it("never deletes anything and never re-writes the STOPPED risk state", () => {
    assert.ok(!/\.delete\(|\.deleteMany\(/.test(svc), "service must never delete");
    assert.ok(!svc.includes("liveSessionState"), "service must not touch the internal lock's session state");
    assert.ok(!svc.includes('riskState'), "service must not change riskState");
  });

  it("the only InternalLockEvent write is the brokerActionTaken flag", () => {
    // No clearedAt / internalOnly mutation — the lock itself is untouched.
    const updates = svc.match(/internalLockEvent\.update\([\s\S]*?\}\)/g) ?? [];
    for (const u of updates) {
      assert.ok(!u.includes("clearedAt"), "must not clear the lock");
      assert.ok(!u.includes("internalOnly"), "must not flip internalOnly");
    }
  });

  it("reuses the isolated manual broker orchestrator (not the daily-loss path)", () => {
    assert.ok(svc.includes("applyManualBrokerLock"), "must call the manual broker orchestrator");
    assert.ok(
      !svc.includes("applyBrokerDayLockout") && !svc.includes("triggerEnforcement"),
      "must NOT reuse the automatic daily-loss enforcement entry points (keeps that path untouched)",
    );
  });
});
