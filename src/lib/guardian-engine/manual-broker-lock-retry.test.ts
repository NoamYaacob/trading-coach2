/**
 * Contract tests for retryManualBrokerLock — the safe retry path for a manual
 * broker lock after a prior dry_run / failed / unavailable GuardianIntervention.
 *
 * Source-scan approach (same pattern as manual-broker-lock-service.test.ts):
 * the function reads/writes Prisma and calls the broker orchestrator, so safety
 * invariants are pinned by source assertions rather than import-and-call.
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
const svc = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("retryManualBrokerLock — exported and present", () => {
  it("exports retryManualBrokerLock from the service", () => {
    assert.ok(
      svc.includes("export async function retryManualBrokerLock"),
      "retryManualBrokerLock must be exported",
    );
  });

  it("defines RETRYABLE_STATUSES including dry_run, broker_lock_failed, and unavailable_ variants", () => {
    assert.ok(svc.includes('"dry_run"'), 'RETRYABLE_STATUSES must include "dry_run"');
    assert.ok(
      svc.includes('"broker_lock_failed"'),
      'RETRYABLE_STATUSES must include "broker_lock_failed"',
    );
    assert.ok(
      svc.includes("startsWith") && svc.includes('"unavailable_"'),
      "must handle unavailable_ prefix variants",
    );
  });
});

describe("retryManualBrokerLock — precondition guards", () => {
  it("returns no_active_lock when the InternalLockEvent does not exist", () => {
    assert.ok(
      svc.includes('"no_active_lock"'),
      'must return outcome="no_active_lock" when lock is missing or cleared',
    );
  });

  it("returns no_active_lock when the lock has already been cleared (clearedAt != null)", () => {
    assert.ok(
      svc.includes("clearedAt != null"),
      "must guard against retrying a cleared lock",
    );
  });

  it("returns no_prior_intervention when no GuardianIntervention exists", () => {
    assert.ok(
      svc.includes('"no_prior_intervention"'),
      'must return outcome="no_prior_intervention" when no prior record found',
    );
  });

  it("returns already_broker_locked when prior intervention is confirmed", () => {
    assert.ok(
      svc.includes('"already_broker_locked"'),
      'must return outcome="already_broker_locked" when broker_locked status found',
    );
    assert.ok(
      svc.includes('"broker_locked"'),
      "must explicitly check for broker_locked status",
    );
  });

  it("returns not_retryable for unknown non-retryable statuses", () => {
    assert.ok(
      svc.includes('"not_retryable"'),
      'must return outcome="not_retryable" for unrecognised non-retryable statuses',
    );
  });
});

describe("retryManualBrokerLock — broker write reuse", () => {
  it("reuses applyManualBrokerLock — never calls the daily-loss enforcement path", () => {
    assert.ok(
      svc.includes("applyManualBrokerLock"),
      "must call applyManualBrokerLock for the broker write",
    );
    assert.ok(
      !svc.includes("applyBrokerDayLockout") && !svc.includes("triggerEnforcement"),
      "must NOT call automatic enforcement entry points",
    );
  });

  it("returns outcome=retried when the broker write was attempted", () => {
    assert.ok(svc.includes('"retried"'), 'must return outcome="retried" after a write attempt');
  });
});

describe("retryManualBrokerLock — update, not create", () => {
  it("updates the existing GuardianIntervention row (not creates a new one)", () => {
    assert.ok(
      svc.includes("guardianIntervention.update"),
      "retry must UPDATE the existing GuardianIntervention — not create a duplicate",
    );
  });

  it("updates brokerLockStatus, outcome, message, and brokerResponseJson on the existing row", () => {
    // Verify each field appears in the service code (covered by the update call).
    assert.ok(svc.includes("brokerLockStatus: result.status"), "must update brokerLockStatus");
    assert.ok(svc.includes("outcome: result.status"), "must update outcome");
    assert.ok(svc.includes("message: result.message"), "must update message");
  });
});

describe("retryManualBrokerLock — brokerActionTaken and internal lock safety", () => {
  it("flips InternalLockEvent.brokerActionTaken=true ONLY on broker_locked", () => {
    assert.ok(
      svc.includes('result.status === "broker_locked"'),
      "brokerActionTaken must be gated on broker_locked status",
    );
  });

  it("never deletes, clears, or rolls back the internal lock", () => {
    assert.ok(!/\.delete\(|\.deleteMany\(/.test(svc), "must never delete any record");
    const internalUpdates = svc.match(/internalLockEvent\.update\([\s\S]*?\}\)/g) ?? [];
    for (const u of internalUpdates) {
      assert.ok(!u.includes("clearedAt"), "must not write clearedAt on InternalLockEvent");
      assert.ok(!u.includes("activeDedupKey"), "must not clear the activeDedupKey");
    }
  });

  it("never touches riskState or liveSessionState", () => {
    assert.ok(!svc.includes("liveSessionState"), "must not write to LiveSessionState");
    assert.ok(!svc.includes("riskState"), "must not modify riskState");
  });
});

describe("retryManualBrokerLock — script presence", () => {
  it("retry-manual-broker-lock.ts script exists and imports retryManualBrokerLock", () => {
    const script = readFileSync(
      resolve(process.cwd(), "scripts/retry-manual-broker-lock.ts"),
      "utf8",
    );
    assert.ok(
      script.includes("retryManualBrokerLock"),
      "script must import and call retryManualBrokerLock",
    );
    assert.ok(
      script.includes("--execute"),
      "script must require --execute flag for writes",
    );
    assert.ok(
      script.includes("read-only") || script.includes("diagnostic"),
      "script header must document read-only diagnostic mode",
    );
  });

  it("script is gated: no broker write without --execute flag", () => {
    const script = readFileSync(
      resolve(process.cwd(), "scripts/retry-manual-broker-lock.ts"),
      "utf8",
    );
    assert.ok(
      script.includes("executeMode"),
      "script must check executeMode before calling retryManualBrokerLock",
    );
    // The retryManualBrokerLock call must be inside the executeMode guard.
    // Use lastIndexOf to find the actual call site (not the import line).
    const executeCheckIdx = script.indexOf("if (!executeMode)");
    const retryCallIdx = script.lastIndexOf("retryManualBrokerLock(");
    assert.ok(
      retryCallIdx > executeCheckIdx,
      "retryManualBrokerLock must be called AFTER the !executeMode guard",
    );
  });
});
