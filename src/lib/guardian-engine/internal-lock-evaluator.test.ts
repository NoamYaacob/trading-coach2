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
// Source-scan: applyInternalLockForConnection returns InternalLockResult[]
// Phase 2C-E: structured return so listener can pass lock event IDs to the
// broker enforcement service without an extra DB round-trip.
// ---------------------------------------------------------------------------

describe("applyInternalLockForConnection — structured return value (Phase 2C-E)", () => {
  const dbSrc = readSrc("src/lib/guardian-engine/internal-lock-evaluator-db.ts");

  it("exports InternalLockResult type", () => {
    assert.ok(
      dbSrc.includes("InternalLockResult"),
      "must export InternalLockResult type for the listener to type-check the result",
    );
  });

  it("returns InternalLockResult[] instead of void", () => {
    assert.ok(
      dbSrc.includes("Promise<InternalLockResult[]>"),
      "function must return Promise<InternalLockResult[]> so listener can read lock event IDs",
    );
    assert.ok(
      !dbSrc.includes("Promise<void>"),
      "void return is no longer allowed — listener needs the structured result",
    );
  });

  it("returns [] on feature flag disabled (early exit)", () => {
    assert.ok(
      dbSrc.includes("return [];"),
      "must return [] (not void/undefined) when feature flag is off or no accounts found",
    );
  });

  it("captures upsert result to obtain the lock event id", () => {
    // The transaction destructures [liveSessionStateResult, lockEvent] so lockEvent.id is accessible.
    assert.ok(
      dbSrc.includes("lockEvent"),
      "upsert result must be captured as lockEvent to surface its id to the caller",
    );
  });

  it("includes internalLockEventId in the returned result", () => {
    assert.ok(
      dbSrc.includes("internalLockEventId: lockEvent.id"),
      "result must include internalLockEventId: lockEvent.id so the listener can pass it to the broker enforcement service",
    );
  });

  it("includes skipReason in the returned result when skipping", () => {
    assert.ok(
      dbSrc.includes("skipReason"),
      "result must include skipReason so skip conditions are observable without a separate DB query",
    );
  });

  it("createdOrUpdated is true only when lock was applied", () => {
    assert.ok(
      dbSrc.includes("createdOrUpdated: true"),
      "result must set createdOrUpdated=true when a lock was upserted",
    );
    assert.ok(
      dbSrc.includes("createdOrUpdated: false"),
      "result must set createdOrUpdated=false when the account was skipped",
    );
  });

  it("still does not call any broker API", () => {
    for (const banned of ["applyBrokerDayLockout", "triggerEnforcement", "userAccountAutoLiq"]) {
      assert.ok(!dbSrc.includes(banned), `internal-lock-evaluator-db must not call ${banned} even with new return type`);
    }
  });
});

// ---------------------------------------------------------------------------
// Source-scan: pre-existing lock lookup when account already STOPPED (Phase 2C-E fix)
//
// Root cause fixed: applyInternalLockForConnection previously returned
// internalLockEventId=null for any account with riskState=STOPPED, even when
// an active InternalLockEvent existed. The listener's null guard then skipped
// maybeAttemptBrokerDailyLossLockoutForInternalLock entirely. The fix queries
// for an existing active lock in the STOPPED branch and returns its ID.
// ---------------------------------------------------------------------------

describe("applyInternalLockForConnection — pre-existing lock lookup when already STOPPED (Phase 2C-E fix)", () => {
  const dbSrc = readSrc("src/lib/guardian-engine/internal-lock-evaluator-db.ts");

  it("queries for an existing active InternalLockEvent when account is already STOPPED", () => {
    assert.ok(
      dbSrc.includes("internalLockEvent.findFirst"),
      "STOPPED branch must call findFirst to surface a pre-existing active lock to the broker enforcement service",
    );
  });

  it("restricts lookup to active locks only — clearedAt: null", () => {
    assert.ok(
      dbSrc.includes("clearedAt: null"),
      "lookup must require clearedAt: null so cleared (reset) locks are not returned",
    );
  });

  it("restricts lookup to active locks only — activeDedupKey IS NOT NULL", () => {
    assert.ok(
      dbSrc.includes("activeDedupKey: { not: null }"),
      "lookup must require activeDedupKey IS NOT NULL — cleared locks have activeDedupKey=null",
    );
  });

  it("returns existing lock id as internalLockEventId with null-safe fallback", () => {
    assert.ok(
      dbSrc.includes("existingLock?.id ?? null"),
      "must use existingLock?.id ?? null so no-lock case returns null internalLockEventId",
    );
  });

  it("returns existing lock ruleType with null-safe fallback", () => {
    assert.ok(
      dbSrc.includes("existingLock?.ruleType ?? null"),
      "must use existingLock?.ruleType ?? null so no-lock case returns null ruleType",
    );
  });

  it("does not create a new InternalLockEvent in the STOPPED branch", () => {
    assert.ok(
      !dbSrc.includes("internalLockEvent.create"),
      "STOPPED branch must never call create — only findFirst to look up existing rows",
    );
  });

  it("prefers newest lock by createdAt desc", () => {
    assert.ok(
      dbSrc.includes('orderBy: { createdAt: "desc" }'),
      "lookup must order by createdAt desc to prefer the most recent active lock",
    );
  });

  it("does not call any broker API in the lookup path", () => {
    for (const banned of ["applyBrokerDayLockout", "triggerEnforcement", "userAccountAutoLiq"]) {
      assert.ok(!dbSrc.includes(banned), `STOPPED branch lookup must not call ${banned}`);
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
