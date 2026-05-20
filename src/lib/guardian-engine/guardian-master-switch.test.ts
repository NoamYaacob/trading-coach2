/**
 * Guardian master-switch tests.
 *
 * Pure-function tests for isGuardianRuleEvaluationActive, plus source-scan
 * guards confirming every rule-evaluation / enforcement entry point is gated
 * on the switch and that listener data sync is NOT gated by it.
 *
 * Run: npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { isGuardianRuleEvaluationActive } from "./guardian-master-switch.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

function read(relPath: string): string {
  return readFileSync(join(__dirname, relPath), "utf8");
}

const DRY_RUN_DB_SRC = read("dry-run-rule-evaluator-db.ts");
const INTERNAL_LOCK_DB_SRC = read("internal-lock-evaluator-db.ts");
const BROKER_SERVICE_SRC = read("broker-enforcement-service.ts");
const LISTENER_WORKER_SRC = readFileSync(
  join(__dirname, "../../../scripts/tradovate-listener-worker.ts"),
  "utf8",
);

// ── Pure decision ─────────────────────────────────────────────────────────────

describe("isGuardianRuleEvaluationActive", () => {
  it("returns true when Guardian is enabled", () => {
    assert.equal(isGuardianRuleEvaluationActive({ guardianEnabled: true }), true);
  });

  it("returns false when Guardian is disabled", () => {
    assert.equal(isGuardianRuleEvaluationActive({ guardianEnabled: false }), false);
  });

  it("returns false when the GuardianProfile is null (no profile yet)", () => {
    assert.equal(isGuardianRuleEvaluationActive(null), false);
  });

  it("returns false when the GuardianProfile is undefined", () => {
    assert.equal(isGuardianRuleEvaluationActive(undefined), false);
  });
});

// ── Source-scan: dry-run evaluation is gated ──────────────────────────────────

describe("dry-run evaluator DB layer is gated on Guardian", () => {
  it("imports the master-switch helper", () => {
    assert.ok(
      DRY_RUN_DB_SRC.includes("isGuardianRuleEvaluationActive"),
      "must import isGuardianRuleEvaluationActive",
    );
  });

  it("loads guardianProfile.guardianEnabled for each account", () => {
    assert.ok(
      DRY_RUN_DB_SRC.includes("guardianProfile") &&
        DRY_RUN_DB_SRC.includes("guardianEnabled"),
      "must select the user's GuardianProfile.guardianEnabled",
    );
  });

  it("skips (continue) when Guardian is disabled", () => {
    assert.ok(
      DRY_RUN_DB_SRC.includes("!isGuardianRuleEvaluationActive"),
      "must branch on a disabled Guardian",
    );
  });
});

// ── Source-scan: internal lock is gated ───────────────────────────────────────

describe("internal lock evaluator DB layer is gated on Guardian", () => {
  it("imports the master-switch helper", () => {
    assert.ok(
      INTERNAL_LOCK_DB_SRC.includes("isGuardianRuleEvaluationActive"),
      "must import isGuardianRuleEvaluationActive",
    );
  });

  it("loads guardianProfile.guardianEnabled for each account", () => {
    assert.ok(
      INTERNAL_LOCK_DB_SRC.includes("guardianProfile") &&
        INTERNAL_LOCK_DB_SRC.includes("guardianEnabled"),
      "must select the user's GuardianProfile.guardianEnabled",
    );
  });

  it("skips guardian-off accounts before the canApplyInternalLock branch", () => {
    const guardIdx = INTERNAL_LOCK_DB_SRC.indexOf("!isGuardianRuleEvaluationActive");
    const canApplyIdx = INTERNAL_LOCK_DB_SRC.indexOf("canApplyInternalLock({");
    assert.ok(guardIdx > -1, "must check the master switch");
    assert.ok(canApplyIdx > -1, "must still call canApplyInternalLock");
    assert.ok(
      guardIdx < canApplyIdx,
      "Guardian check must run before canApplyInternalLock so a guardian-off " +
        "account never returns an internalLockEventId",
    );
  });
});

// ── Source-scan: broker enforcement is gated ──────────────────────────────────

describe("broker enforcement service is gated on Guardian", () => {
  it("imports the master-switch helper", () => {
    assert.ok(
      BROKER_SERVICE_SRC.includes("isGuardianRuleEvaluationActive"),
      "must import isGuardianRuleEvaluationActive",
    );
  });

  it("returns a skip result when Guardian is disabled", () => {
    assert.ok(
      BROKER_SERVICE_SRC.includes("!isGuardianRuleEvaluationActive"),
      "must branch on a disabled Guardian and skip enforcement",
    );
  });
});

// ── Source-scan: listener data sync is NOT gated by Guardian ──────────────────

describe("listener still syncs account/connection data when Guardian is off", () => {
  it("writes listener event timestamps unconditionally on every props event", () => {
    assert.ok(
      LISTENER_WORKER_SRC.includes("void writeListenerEventTimestamp(connectionId)"),
      "listener must stamp event timestamps regardless of Guardian state",
    );
  });

  it("runs reconciliation on every ready/reconnect regardless of Guardian", () => {
    assert.ok(
      LISTENER_WORKER_SRC.includes("reconcileAndPersist(connectionId"),
      "listener must reconcile account data regardless of Guardian state",
    );
  });

  it("does not gate the worker itself on Guardian (gating lives in the evaluators)", () => {
    assert.ok(
      !LISTENER_WORKER_SRC.includes("guardianEnabled") &&
        !LISTENER_WORKER_SRC.includes("isGuardianRuleEvaluationActive"),
      "the Guardian gate belongs in the rule evaluators, not the sync loop",
    );
  });
});
