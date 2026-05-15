/**
 * Phase 2B: unit tests for the pure internal-lock gate logic.
 *
 * Safety properties verified:
 *   - Flag=false  → lock never applied (feature flag gate)
 *   - env=live    → lock never applied (demo-only gate)
 *   - STOPPED     → lock not re-applied (idempotent gate)
 *   - All three gates must pass simultaneously
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { canApplyInternalLock, buildInternalLockDedupKey } from "./internal-lock-evaluator.ts";

const root = resolve(import.meta.dirname, "../../..");
function readSrc(rel: string) {
  return readFileSync(resolve(root, rel), "utf8");
}

describe("canApplyInternalLock", () => {
  it("returns true when all gates pass", () => {
    assert.equal(canApplyInternalLock({ flagEnabled: true, env: "demo", riskState: "NORMAL" }), true);
  });

  it("returns true for WARNING state (not yet locked)", () => {
    assert.equal(canApplyInternalLock({ flagEnabled: true, env: "demo", riskState: "WARNING" }), true);
  });

  // ── Feature flag gate ──────────────────────────────────────────────────────

  it("returns false when flag is disabled", () => {
    assert.equal(canApplyInternalLock({ flagEnabled: false, env: "demo", riskState: "NORMAL" }), false);
  });

  it("flag=false overrides demo env and NORMAL state", () => {
    assert.equal(canApplyInternalLock({ flagEnabled: false, env: "demo", riskState: "NORMAL" }), false);
  });

  // ── Demo-only gate ─────────────────────────────────────────────────────────

  it("returns false for live accounts", () => {
    assert.equal(canApplyInternalLock({ flagEnabled: true, env: "live", riskState: "NORMAL" }), false);
  });

  it("returns false for live even when flag=true and NORMAL", () => {
    assert.equal(canApplyInternalLock({ flagEnabled: true, env: "live", riskState: "NORMAL" }), false);
  });

  it("returns false for unknown env", () => {
    assert.equal(canApplyInternalLock({ flagEnabled: true, env: "staging", riskState: "NORMAL" }), false);
  });

  // ── Idempotent gate ────────────────────────────────────────────────────────

  it("returns false when already STOPPED", () => {
    assert.equal(canApplyInternalLock({ flagEnabled: true, env: "demo", riskState: "STOPPED" }), false);
  });

  it("STOPPED gate overrides — not re-locked even with all other gates passing", () => {
    assert.equal(canApplyInternalLock({ flagEnabled: true, env: "demo", riskState: "STOPPED" }), false);
  });

  // ── Combined gate interactions ─────────────────────────────────────────────

  it("flag=false + live + STOPPED → false", () => {
    assert.equal(canApplyInternalLock({ flagEnabled: false, env: "live", riskState: "STOPPED" }), false);
  });

  it("flag=true + live + STOPPED → false", () => {
    assert.equal(canApplyInternalLock({ flagEnabled: true, env: "live", riskState: "STOPPED" }), false);
  });
});

// ---------------------------------------------------------------------------
// buildInternalLockDedupKey — Phase 2B idempotency fix
// ---------------------------------------------------------------------------

describe("buildInternalLockDedupKey", () => {
  it("produces the expected key format", () => {
    const key = buildInternalLockDedupKey("acc1", "daily_loss_limit", "2026-05-15");
    assert.equal(key, "acc1:daily_loss_limit:2026-05-15:internal_lock");
  });

  it("ends with :internal_lock suffix", () => {
    const key = buildInternalLockDedupKey("acc1", "trade_limit", "2026-05-15");
    assert.ok(key.endsWith(":internal_lock"), `key did not end with :internal_lock — got ${key}`);
  });

  it("is deterministic — same inputs produce same key", () => {
    const a = buildInternalLockDedupKey("acc99", "daily_loss_limit", "2026-05-15");
    const b = buildInternalLockDedupKey("acc99", "daily_loss_limit", "2026-05-15");
    assert.equal(a, b);
  });

  it("differs across accounts", () => {
    const a = buildInternalLockDedupKey("acc1", "daily_loss_limit", "2026-05-15");
    const b = buildInternalLockDedupKey("acc2", "daily_loss_limit", "2026-05-15");
    assert.notEqual(a, b);
  });

  it("differs across rule types", () => {
    const a = buildInternalLockDedupKey("acc1", "daily_loss_limit", "2026-05-15");
    const b = buildInternalLockDedupKey("acc1", "trade_limit", "2026-05-15");
    assert.notEqual(a, b);
  });

  it("differs across trading days", () => {
    const a = buildInternalLockDedupKey("acc1", "daily_loss_limit", "2026-05-14");
    const b = buildInternalLockDedupKey("acc1", "daily_loss_limit", "2026-05-15");
    assert.notEqual(a, b);
  });

  it("does not collide with Phase 2C broker enforcement key", () => {
    // broker enforcement key ends with :broker_enforcement, not :internal_lock
    const internalKey = buildInternalLockDedupKey("acc1", "daily_loss_limit", "2026-05-15");
    const brokerKey = "acc1:daily_loss_limit:2026-05-15:broker_enforcement";
    assert.notEqual(internalKey, brokerKey);
  });
});

// ---------------------------------------------------------------------------
// Source-scan: applyInternalLockForConnection uses upsert (not create)
// ---------------------------------------------------------------------------

describe("applyInternalLockForConnection — idempotency fix", () => {
  const dbSrc = readSrc("src/lib/guardian-engine/internal-lock-evaluator-db.ts");

  it("uses upsert instead of create for InternalLockEvent", () => {
    assert.ok(
      dbSrc.includes("internalLockEvent.upsert"),
      "applyInternalLockForConnection must use upsert to prevent duplicate rows",
    );
  });

  it("does not use bare internalLockEvent.create", () => {
    assert.ok(
      !dbSrc.includes("internalLockEvent.create"),
      "bare create() would allow duplicate active lock rows — must use upsert",
    );
  });

  it("passes activeDedupKey to the upsert where clause", () => {
    assert.ok(
      dbSrc.includes("activeDedupKey"),
      "upsert must use activeDedupKey as the conflict target",
    );
  });

  it("imports buildInternalLockDedupKey", () => {
    assert.ok(
      dbSrc.includes("buildInternalLockDedupKey"),
      "must import and use buildInternalLockDedupKey to generate the dedup key",
    );
  });

  it("does not call any broker API", () => {
    for (const banned of ["applyBrokerDayLockout", "triggerEnforcement", "userAccountAutoLiq"]) {
      assert.ok(!dbSrc.includes(banned), `internal-lock-evaluator-db must not call ${banned}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Source-scan: reset endpoint nulls activeDedupKey on clear
// ---------------------------------------------------------------------------

describe("reset-session-state — activeDedupKey cleared on reset", () => {
  const resetSrc = readSrc(
    "src/app/api/debug/accounts/[accountId]/reset-session-state/route.ts",
  );

  it("sets activeDedupKey to null on manual reset", () => {
    assert.ok(
      resetSrc.includes("activeDedupKey: null"),
      "reset endpoint must set activeDedupKey=null so the slot can be reused after reset",
    );
  });

  it("uses updateMany to clear all active locks (not just one)", () => {
    assert.ok(
      resetSrc.includes("internalLockEvent.updateMany"),
      "reset must use updateMany to clear all active locks for the account",
    );
  });

  it("filters by clearedAt: null to target only active locks", () => {
    assert.ok(
      resetSrc.includes("clearedAt: null"),
      "reset must filter to only active locks (clearedAt IS NULL)",
    );
  });
});

// ---------------------------------------------------------------------------
// Source-scan: InternalLockEvent schema has activeDedupKey @unique
// ---------------------------------------------------------------------------

describe("InternalLockEvent schema — activeDedupKey unique constraint", () => {
  const schema = readSrc("prisma/schema.prisma");

  it("has activeDedupKey field on InternalLockEvent", () => {
    assert.ok(
      schema.includes("activeDedupKey"),
      "InternalLockEvent must have activeDedupKey field",
    );
  });

  it("activeDedupKey is @unique", () => {
    // Find the activeDedupKey line and verify @unique is on it
    const lines = schema.split("\n");
    const dedupLine = lines.find((l) => l.includes("activeDedupKey"));
    assert.ok(dedupLine != null, "activeDedupKey field not found in schema");
    assert.ok(
      dedupLine.includes("@unique"),
      `activeDedupKey line must have @unique — got: ${dedupLine.trim()}`,
    );
  });

  it("activeDedupKey is nullable (String?)", () => {
    const lines = schema.split("\n");
    const dedupLine = lines.find((l) => l.includes("activeDedupKey"));
    assert.ok(dedupLine != null);
    assert.ok(
      dedupLine.includes("String?"),
      `activeDedupKey must be nullable (String?) so cleared rows can set it to null — got: ${dedupLine.trim()}`,
    );
  });
});
