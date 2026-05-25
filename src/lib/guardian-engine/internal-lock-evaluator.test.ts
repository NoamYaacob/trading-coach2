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

  it("returns existing lock id as internalLockEventId when lock found (guarded by if-block)", () => {
    assert.ok(
      dbSrc.includes("internalLockEventId: existingLock.id"),
      "must reference existingLock.id when lock is found (guarded by if(existingLock) block)",
    );
  });

  it("returns null internalLockEventId when no lock exists and no violation to backfill", () => {
    assert.ok(
      dbSrc.includes("no active violation to backfill"),
      "must return internalLockEventId=null when STOPPED but no existing lock and no current violation",
    );
  });

  it("does not use bare internalLockEvent.create in STOPPED branch (backfill uses upsert)", () => {
    assert.ok(
      !dbSrc.includes("internalLockEvent.create"),
      "STOPPED branch must not call bare create() — backfill uses upsert with activeDedupKey conflict target",
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
// Source-scan: backfill when sync-path STOPPED without InternalLockEvent (C1 gap fix)
//
// Root cause: syncTradovateAccount evaluates rules independently and sets
// riskState=STOPPED without creating an InternalLockEvent. When
// applyInternalLockForConnection later runs (on a WebSocket props event), it
// sees STOPPED, skips rule evaluation, and previously returned
// internalLockEventId=null — making broker enforcement unreachable.
//
// Fix: when the STOPPED branch finds no existing InternalLockEvent, re-evaluate
// rules and backfill one via upsert if a breach is still active.
// ---------------------------------------------------------------------------

describe("applyInternalLockForConnection — backfill when sync-path STOPPED without InternalLockEvent", () => {
  const dbSrc = readSrc("src/lib/guardian-engine/internal-lock-evaluator-db.ts");

  it("re-evaluates rules in the STOPPED branch when no existing lock is found", () => {
    assert.ok(
      dbSrc.includes("backfillViolations"),
      "STOPPED branch must re-evaluate rules via evaluateDryRunRules when no existing lock is found",
    );
  });

  it("backfill uses upsert — not create — for race safety under concurrent props events", () => {
    const dedupIdx = dbSrc.indexOf("backfillDedupKey");
    const upsertIdx = dbSrc.indexOf("internalLockEvent.upsert", dedupIdx - 50);
    assert.ok(
      dedupIdx > -1 && upsertIdx > -1,
      "backfill must use upsert with activeDedupKey conflict target — not bare create()",
    );
  });

  it("backfill calls buildInternalLockDedupKey for the same dedup key format as the normal path", () => {
    const matches = [...dbSrc.matchAll(/buildInternalLockDedupKey/g)];
    assert.ok(
      matches.length >= 2,
      "buildInternalLockDedupKey must appear in both the normal create path and the backfill path",
    );
  });

  it("backfill skips and returns null internalLockEventId when no violation is currently detected", () => {
    assert.ok(
      dbSrc.includes("no active violation to backfill"),
      "backfill must return internalLockEventId=null when rules do not currently show a breach",
    );
  });

  it("backfill sets createdOrUpdated=true when a lock event is backfilled", () => {
    const backfillLogIdx = dbSrc.indexOf("backfilling InternalLockEvent");
    const createdOrUpdatedIdx = dbSrc.indexOf("createdOrUpdated: true", backfillLogIdx);
    assert.ok(
      backfillLogIdx > -1 && createdOrUpdatedIdx > -1,
      "backfill result must set createdOrUpdated=true so the listener can distinguish backfill from no-op",
    );
  });

  it("backfill logs the sync-path-STOPPED cause for observability", () => {
    assert.ok(
      dbSrc.includes("sync-path STOPPED without lock event"),
      "backfill must log the cause so Railway logs can distinguish backfill events from normal lock creation",
    );
  });

  it("backfill does not call any broker API", () => {
    for (const banned of ["applyBrokerDayLockout", "triggerEnforcement", "userAccountAutoLiq"]) {
      assert.ok(!dbSrc.includes(banned), `backfill path must not call ${banned}`);
    }
  });

  it("backfill passes dailyProfitTarget: null to exclude profit-target from enforcement path", () => {
    const backfillIdx = dbSrc.indexOf("backfillInput");
    const profitNullIdx = dbSrc.indexOf("dailyProfitTarget: null", backfillIdx);
    assert.ok(
      backfillIdx > -1 && profitNullIdx > -1,
      "backfill input must pass dailyProfitTarget: null — profit-target never creates an InternalLockEvent",
    );
  });
});

// ---------------------------------------------------------------------------
// Source-scan: sync-path root cause documentation
//
// syncTradovateAccount has its own rule evaluator (Phase 2A). It evaluates
// daily_loss_limit independently and calls triggerEnforcement → GuardianIntervention.
// It does NOT create InternalLockEvents — that is the listener path's job.
// This test documents the architectural separation so the dual-path design is
// explicit and regressions are caught.
// ---------------------------------------------------------------------------

describe("syncTradovateAccount — own rule evaluator creates GuardianIntervention, not InternalLockEvent", () => {
  const syncSrc = readSrc("src/lib/brokers/tradovate-sync.ts");

  function codeOnlySync(): string {
    let s = syncSrc;
    s = s.replace(/\/\*[\s\S]*?\*\//g, "");
    s = s.replace(/(^|[^:])\/\/.*$/gm, "$1");
    return s;
  }

  it("sync evaluates daily_loss_limit using lossPct >= 1.0 and transitions to STOPPED", () => {
    assert.ok(
      syncSrc.includes("lossPct") && syncSrc.includes("lossPct >= 1.0"),
      "sync must evaluate daily_loss_limit via lossPct and set newRiskState=STOPPED",
    );
    assert.ok(
      syncSrc.includes('"STOPPED"'),
      "sync must write riskState=STOPPED to LiveSessionState when breach is detected",
    );
  });

  it("sync calls triggerEnforcement on the NORMAL → STOPPED transition", () => {
    assert.ok(
      codeOnlySync().includes("triggerEnforcement"),
      "sync must call triggerEnforcement to create a GuardianIntervention audit record",
    );
    assert.ok(
      syncSrc.includes("violationCreated"),
      "sync must guard triggerEnforcement behind violationCreated (NORMAL → STOPPED transition only)",
    );
  });

  it("sync does NOT create InternalLockEvent rows — listener path only", () => {
    assert.ok(
      !codeOnlySync().includes("internalLockEvent"),
      "sync must not create InternalLockEvent — that is the listener path's responsibility (applyInternalLockForConnection)",
    );
  });

  it("sync does NOT import applyInternalLockForConnection", () => {
    assert.ok(
      !syncSrc.includes("applyInternalLockForConnection"),
      "sync must not import or call applyInternalLockForConnection — the listener triggers it via WebSocket props events",
    );
  });
});

// ---------------------------------------------------------------------------
// Source-scan: BROKER_ENFORCEMENT_ENABLED gate — enforcement stays blocked
//
// When BROKER_ENFORCEMENT_ENABLED=false the listener worker skips the broker
// enforcement service even when applyInternalLockForConnection returns a valid
// internalLockEventId. Verified by reading the listener-worker source.
// ---------------------------------------------------------------------------

describe("listener worker — BROKER_ENFORCEMENT_ENABLED gates broker writes even with a valid lock event", () => {
  const listenerSrc = readSrc("scripts/tradovate-listener-worker.ts");

  it("checks BROKER_ENFORCEMENT_ENABLED before calling maybeAttemptBrokerDailyLossLockoutForInternalLock", () => {
    const brokerEnabledIdx = listenerSrc.indexOf('BROKER_ENFORCEMENT_ENABLED !== "true"');
    // Use lastIndexOf to skip the import line — we want the call-site occurrence.
    const lockoutIdx = listenerSrc.lastIndexOf("maybeAttemptBrokerDailyLossLockoutForInternalLock");
    assert.ok(
      brokerEnabledIdx > -1 && lockoutIdx > -1,
      "listener must gate broker enforcement behind BROKER_ENFORCEMENT_ENABLED check",
    );
    assert.ok(
      brokerEnabledIdx < lockoutIdx,
      "BROKER_ENFORCEMENT_ENABLED check must appear before maybeAttemptBrokerDailyLossLockoutForInternalLock call-site",
    );
  });

  it("skips broker enforcement when BROKER_ENFORCEMENT_ENABLED is false (return in the check)", () => {
    assert.ok(
      listenerSrc.includes('BROKER_ENFORCEMENT_ENABLED !== "true"'),
      "early-return check for BROKER_ENFORCEMENT_ENABLED=false must be present",
    );
  });

  it("checks GUARDRAIL_INTERNAL_LOCK_ENABLED before calling applyInternalLockForConnection", () => {
    const internalLockFlagIdx = listenerSrc.indexOf('GUARDRAIL_INTERNAL_LOCK_ENABLED === "true"');
    // Use lastIndexOf to skip the import line — we want the call-site occurrence.
    const applyLockIdx = listenerSrc.lastIndexOf("applyInternalLockForConnection");
    assert.ok(
      internalLockFlagIdx > -1 && applyLockIdx > -1,
      "listener must gate applyInternalLockForConnection behind GUARDRAIL_INTERNAL_LOCK_ENABLED",
    );
    assert.ok(
      internalLockFlagIdx < applyLockIdx,
      "GUARDRAIL_INTERNAL_LOCK_ENABLED check must appear before applyInternalLockForConnection call-site",
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

// ---------------------------------------------------------------------------
// trade_limit (maxTradesPerDay) internal-lock wiring — source scan
//
// Pure-evaluator semantics for trade_limit are covered in
// dry-run-rule-evaluator.test.ts. These tests verify the DB integration
// layer carries trade_limit through end-to-end without any broker side-effects.
//
// Documented semantics: maxTradesPerDay is the inclusive cap. The lock fires
// when tradesCount >= maxTradesPerDay (the configured limit IS the trigger).
// Suppressed unless tradeCountSource === "verified".
// ---------------------------------------------------------------------------

describe("trade_limit internal-lock wiring (DB integration source-scan)", () => {
  const dbSrc = readSrc("src/lib/guardian-engine/internal-lock-evaluator-db.ts");
  const evaluatorSrc = readSrc("src/lib/guardian-engine/dry-run-rule-evaluator.ts");

  it("dry-run evaluator emits trade_limit ruleType", () => {
    assert.ok(
      evaluatorSrc.includes('ruleType: "trade_limit"'),
      "evaluator must emit trade_limit violations",
    );
  });

  it("dry-run evaluator fires trade_limit at-or-above limit (inclusive cap)", () => {
    assert.ok(
      evaluatorSrc.includes("input.tradesCount >= input.maxTradesPerDay"),
      "evaluator must use >= so the configured maxTradesPerDay is the lock trigger",
    );
  });

  it("dry-run evaluator suppresses trade_limit when tradeCountSource is not 'verified'", () => {
    assert.ok(
      evaluatorSrc.includes('input.tradeCountSource !== "verified"'),
      "trade_limit must be suppressed when tradeCountSource is not 'verified'",
    );
  });

  it("dry-run evaluator documents trade_limit semantics inline", () => {
    assert.ok(
      evaluatorSrc.includes("Semantics:") || evaluatorSrc.includes("inclusive cap"),
      "evaluator must document the trade_limit semantics (inclusive cap, >=) so future readers know the intent",
    );
  });

  it("DB layer passes maxTradesPerDay into the primary evaluator call", () => {
    assert.ok(
      dbSrc.includes("maxTradesPerDay: rules.maxTradesPerDay"),
      "primary applyInternalLockForConnection path must pass maxTradesPerDay to evaluateDryRunRules",
    );
  });

  it("DB layer passes maxTradesPerDay into the backfill evaluator call", () => {
    // Both occurrences should reference the same source — once in the
    // primary path and once in the backfill path.
    const matches = [...dbSrc.matchAll(/maxTradesPerDay: rules\.maxTradesPerDay/g)];
    assert.ok(
      matches.length >= 2,
      "backfill path must also pass maxTradesPerDay so STOPPED-without-lock trade_limit cases get backfilled",
    );
  });

  it("DB layer passes tradeCountSource so evaluator can suppress when not verified", () => {
    assert.ok(
      dbSrc.includes("tradeCountSource: session.tradeCountSource"),
      "DB layer must pass tradeCountSource — evaluator needs it to gate trade_limit",
    );
  });

  it("DB layer selects maxTradesPerDay from riskRules", () => {
    assert.ok(
      dbSrc.includes("maxTradesPerDay: true"),
      "Prisma select must include maxTradesPerDay so the evaluator receives the configured cap",
    );
  });

  it("DB layer selects tradesCount and tradeCountSource from sessionState", () => {
    assert.ok(
      dbSrc.includes("tradesCount: true"),
      "Prisma select must include tradesCount from LiveSessionState",
    );
    assert.ok(
      dbSrc.includes("tradeCountSource: true"),
      "Prisma select must include tradeCountSource from LiveSessionState",
    );
  });

  it("upsert propagates the primary violation ruleType — so trade_limit lands as ruleType=trade_limit", () => {
    assert.ok(
      dbSrc.includes("ruleType: primary.ruleType"),
      "upsert must write primary.ruleType so trade_limit violations create ruleType=trade_limit InternalLockEvent rows",
    );
  });

  it("dedup key includes ruleType — trade_limit gets its own slot (one per account+rule+day)", () => {
    // buildInternalLockDedupKey(account.id, primary.ruleType, tradingDay)
    assert.ok(
      dbSrc.includes("buildInternalLockDedupKey(\n        account.id,\n        primary.ruleType") ||
        dbSrc.match(/buildInternalLockDedupKey\([^)]*primary\.ruleType[^)]*\)/),
      "activeDedupKey must include ruleType so trade_limit doesn't collide with daily_loss_limit",
    );
  });

  it("internalOnly=true and brokerActionTaken=false on trade_limit lock rows", () => {
    assert.ok(
      dbSrc.includes("internalOnly: true"),
      "all internal lock rows must set internalOnly=true",
    );
    assert.ok(
      dbSrc.includes("brokerActionTaken: false"),
      "all internal lock rows must set brokerActionTaken=false — broker writes are a separate Phase 2C path",
    );
  });

  it("DB layer does not call Tradovate write endpoints for trade_limit", () => {
    const forbidden = [
      "TradovateClient",
      "tradovate.post",
      "tradovatePost",
      "setRiskSetting",
      "setDailyLoss",
      "setAutoLiq",
      "userAccountAutoLiq",
      "cancelOrder",
      "cancelAll",
      "flattenPositions",
      "flattenAll",
      "applyBrokerDayLockout",
    ];
    for (const banned of forbidden) {
      assert.ok(!dbSrc.includes(banned), `internal-lock-evaluator-db must not call ${banned}`);
    }
  });

  it("idempotency: upsert (not create) is used so repeated evaluations of the same trade_limit breach do not duplicate rows", () => {
    assert.ok(
      dbSrc.includes("internalLockEvent.upsert"),
      "upsert is required for idempotency — repeated props events from the listener must not create duplicate trade_limit rows",
    );
    assert.ok(
      !dbSrc.includes("internalLockEvent.create("),
      "bare create() would allow duplicate trade_limit InternalLockEvent rows on repeated evaluation",
    );
  });
});

// ---------------------------------------------------------------------------
// trade_limit broker-eligibility: stays internal-only.
//
// The broker enforcement simulation layer explicitly excludes trade_limit from
// the broker-eligible set. This is the safety guarantee that trade_limit
// breaches never trigger a Tradovate setDailyLoss / setAutoLiq write, no
// matter what the BROKER_ENFORCEMENT_ENABLED flag is set to.
// ---------------------------------------------------------------------------

describe("trade_limit stays internal-only (no broker eligibility)", () => {
  const simSrc = readSrc("src/lib/guardian-engine/broker-enforcement-simulation.ts");

  it("BROKER_ELIGIBLE_RULES does not include trade_limit", () => {
    // The constant should explicitly NOT include trade_limit. Look for the
    // exact line that defines the eligible set.
    const match = simSrc.match(/BROKER_ELIGIBLE_RULES\s*=\s*new\s+Set\(\[([^\]]*)\]\)/);
    assert.ok(match, "BROKER_ELIGIBLE_RULES must be defined as a Set literal");
    const setContents = match![1];
    assert.ok(
      !setContents.includes("trade_limit"),
      `BROKER_ELIGIBLE_RULES must NOT include "trade_limit" — found: ${setContents}`,
    );
    assert.ok(
      setContents.includes("daily_loss_limit"),
      "BROKER_ELIGIBLE_RULES must include daily_loss_limit (existing scope)",
    );
  });

  it("simulation rejects non-eligible rule types (gates trade_limit)", () => {
    assert.ok(
      simSrc.includes("BROKER_ELIGIBLE_RULES.has(input.ruleType)"),
      "simulation must gate on BROKER_ELIGIBLE_RULES.has(input.ruleType) so trade_limit is rejected",
    );
  });
});

// ---------------------------------------------------------------------------
// reset-session-state clears trade_limit locks too.
//
// The reset endpoint uses updateMany filtered by accountId + clearedAt=null
// only — no ruleType filter — so it clears ALL active locks including
// trade_limit. This guarantees that a manual reset wipes the trade-limit
// lock state alongside daily_loss_limit / max_loss_streak.
// ---------------------------------------------------------------------------

describe("reset-session-state clears trade_limit locks (no ruleType filter)", () => {
  const resetSrc = readSrc(
    "src/app/api/debug/accounts/[accountId]/reset-session-state/route.ts",
  );

  it("uses internalLockEvent.updateMany to clear all active locks", () => {
    assert.ok(
      resetSrc.includes("internalLockEvent.updateMany"),
      "reset must use updateMany to clear all active locks for the account",
    );
  });

  it("does not filter by ruleType — so trade_limit, daily_loss_limit, max_loss_streak all clear", () => {
    // Extract the updateMany where-clause and verify it does not mention ruleType.
    const idx = resetSrc.indexOf("internalLockEvent.updateMany");
    assert.ok(idx > -1);
    const slice = resetSrc.slice(idx, idx + 400);
    assert.ok(
      !slice.includes("ruleType"),
      "reset updateMany must not filter by ruleType — all active rule types must clear, including trade_limit",
    );
  });

  it("clears activeDedupKey so a trade_limit lock can re-fire same day after reset", () => {
    assert.ok(
      resetSrc.includes("activeDedupKey: null"),
      "reset must null out activeDedupKey so the trade_limit slot can be reused after manual reset",
    );
  });
});
