/**
 * Tests for max_position_size internal-lock enforcement.
 *
 * Verifies:
 *   - Pure semantics of evaluateMaxPositionSizeForLock (allowance model, >)
 *   - DB integration source-scan (no broker writes, dedup key, upsert)
 *   - Broker eligibility: max_position_size stays internal-only
 *   - reset-session-state clears max_position_size locks
 *   - Sync-path integration wires the upsert call when enforcement fires
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  evaluateMaxPositionSizeForLock,
} from "./max-position-size-internal-lock-evaluator.ts";

const root = resolve(import.meta.dirname, "../../..");
function readSrc(rel: string) {
  return readFileSync(resolve(root, rel), "utf8");
}

// ── Pure evaluator semantics ─────────────────────────────────────────────────

describe("evaluateMaxPositionSizeForLock — allowance model (>)", () => {
  it("does not lock when maxContracts is null (rule not configured)", () => {
    const r = evaluateMaxPositionSizeForLock({
      maxContracts: null,
      currentMiniEquivalentExposure: 100,
      hasUnsupportedPositions: false,
    });
    assert.equal(r.shouldLock, false);
    assert.ok(r.skipReason?.includes("not configured"));
  });

  it("does not lock when maxContracts is negative (invalid)", () => {
    const r = evaluateMaxPositionSizeForLock({
      maxContracts: -1,
      currentMiniEquivalentExposure: 5,
      hasUnsupportedPositions: false,
    });
    assert.equal(r.shouldLock, false);
    assert.ok(r.skipReason?.includes("invalid"));
  });

  it("does not lock when exposure is well below maxContracts (1 < 2)", () => {
    const r = evaluateMaxPositionSizeForLock({
      maxContracts: 2,
      currentMiniEquivalentExposure: 1,
      hasUnsupportedPositions: false,
    });
    assert.equal(r.shouldLock, false);
  });

  it("does NOT lock at exactly maxContracts — inclusive allowance (2 of 2 allowed)", () => {
    const r = evaluateMaxPositionSizeForLock({
      maxContracts: 2,
      currentMiniEquivalentExposure: 2,
      hasUnsupportedPositions: false,
    });
    assert.equal(r.shouldLock, false, "exposure === maxContracts is within the allowance, must not lock");
  });

  it("locks when exposure exceeds maxContracts (3 > 2 fires lock)", () => {
    const r = evaluateMaxPositionSizeForLock({
      maxContracts: 2,
      currentMiniEquivalentExposure: 3,
      hasUnsupportedPositions: false,
    });
    assert.equal(r.shouldLock, true);
  });

  it("locks for fractional overage (2.1 > 2 fires lock)", () => {
    const r = evaluateMaxPositionSizeForLock({
      maxContracts: 2,
      currentMiniEquivalentExposure: 2.1,
      hasUnsupportedPositions: false,
    });
    assert.equal(r.shouldLock, true);
  });

  it("does not lock for IEEE-754 fuzz near the boundary (1.1 vs 1.1 via 11×0.1)", () => {
    // 11 micros (0.1 each) sum to 1.1000000000000001 in float — must not trip.
    const exposure = 11 * 0.1;
    const r = evaluateMaxPositionSizeForLock({
      maxContracts: 1.1,
      currentMiniEquivalentExposure: exposure,
      hasUnsupportedPositions: false,
    });
    assert.equal(r.shouldLock, false, "integer-millis comparison must absorb float drift");
  });

  it("does not lock when position data is unavailable (null exposure)", () => {
    const r = evaluateMaxPositionSizeForLock({
      maxContracts: 2,
      currentMiniEquivalentExposure: null,
      hasUnsupportedPositions: false,
    });
    assert.equal(r.shouldLock, false);
    assert.ok(r.skipReason?.includes("unavailable"));
  });

  it("locks when an unsupported symbol is open — safer policy", () => {
    const r = evaluateMaxPositionSizeForLock({
      maxContracts: 2,
      currentMiniEquivalentExposure: null,
      hasUnsupportedPositions: true,
    });
    assert.equal(r.shouldLock, true, "cannot verify exposure → lock");
  });

  it("locks for maxContracts=0 with any non-zero exposure", () => {
    // maxContracts=0 means "no contracts permitted" — any exposure breaches.
    const r = evaluateMaxPositionSizeForLock({
      maxContracts: 0,
      currentMiniEquivalentExposure: 0.1,
      hasUnsupportedPositions: false,
    });
    assert.equal(r.shouldLock, true);
  });

  it("does not lock for maxContracts=0 with zero exposure", () => {
    const r = evaluateMaxPositionSizeForLock({
      maxContracts: 0,
      currentMiniEquivalentExposure: 0,
      hasUnsupportedPositions: false,
    });
    assert.equal(r.shouldLock, false);
  });
});

// ── DB integration source-scan ───────────────────────────────────────────────
//
// The DB layer is exercised end-to-end by the sync path. These structural
// tests document the safety contract without spinning up a real Prisma client.

describe("max_position_size internal-lock module — DB integration source-scan", () => {
  const lockSrc = readSrc("src/lib/guardian-engine/max-position-size-internal-lock-db.ts");

  it("uses internalLockEvent.upsert (not bare create) for idempotency", () => {
    assert.ok(
      lockSrc.includes("internalLockEvent.upsert"),
      "upsert is required so repeated sync cycles do not create duplicate max_position_size rows",
    );
    assert.ok(
      !lockSrc.includes("internalLockEvent.create("),
      "bare create() would allow duplicate InternalLockEvent rows on repeated evaluation",
    );
  });

  it("dedup key includes ruleType — max_position_size doesn't collide with other rule slots", () => {
    assert.ok(
      lockSrc.match(/buildInternalLockDedupKey\([^)]*"max_position_size"[^)]*\)/),
      "activeDedupKey must include the literal ruleType so max_position_size has its own slot",
    );
  });

  it("writes ruleType=\"max_position_size\"", () => {
    assert.ok(
      lockSrc.includes('ruleType: "max_position_size"'),
      "InternalLockEvent must be created with ruleType=\"max_position_size\"",
    );
  });

  it("sets internalOnly=true and brokerActionTaken=false on the lock row", () => {
    assert.ok(
      lockSrc.includes("internalOnly: true"),
      "lock rows for max_position_size must set internalOnly=true",
    );
    assert.ok(
      lockSrc.includes("brokerActionTaken: false"),
      "lock rows for max_position_size must set brokerActionTaken=false — broker writes are out of scope",
    );
  });

  it("gates on GUARDRAIL_INTERNAL_LOCK_ENABLED=\"true\"", () => {
    assert.ok(
      lockSrc.includes('GUARDRAIL_INTERNAL_LOCK_ENABLED !== "true"'),
      "module must early-return when GUARDRAIL_INTERNAL_LOCK_ENABLED is not 'true'",
    );
  });

  it("gates on env=\"demo\" — live accounts never reach the upsert", () => {
    assert.ok(
      lockSrc.includes('input.env !== "demo"'),
      "module must early-return when env is not 'demo' so live accounts are never locked from this path",
    );
  });

  it("does not import or call any Tradovate write endpoint", () => {
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
      "applyMaxPositionSize",
      "order/liquidatepositions",
      "order/cancel",
    ];
    for (const banned of forbidden) {
      assert.ok(
        !lockSrc.includes(banned),
        `max-position-size-internal-lock must not reference ${banned}`,
      );
    }
  });

  it("does not import the broker enforcement / risk-settings service", () => {
    assert.ok(
      !lockSrc.includes("tradovate-risk-settings-service"),
      "module must not import the broker risk-settings service",
    );
    assert.ok(
      !lockSrc.includes("broker-enforcement-service"),
      "module must not import the broker enforcement service",
    );
    assert.ok(
      !lockSrc.includes("tradovate-position-limit"),
      "module must not import the broker-side position limit helper",
    );
  });

  it("does not write to the broker — only writes InternalLockEvent", () => {
    // Whitelist: the only Prisma write should be internalLockEvent.upsert.
    const prismaWrites = [
      "prisma.connectedAccount.update",
      "prisma.brokerConnection.update",
      "prisma.brokerRiskSettingsSyncAudit",
      "prisma.brokerOrderActionLog",
      "prisma.liveSessionState.update",
    ];
    for (const w of prismaWrites) {
      assert.ok(
        !lockSrc.includes(w),
        `module must not write ${w} — only the InternalLockEvent upsert is permitted`,
      );
    }
  });
});

// ── Broker eligibility: max_position_size stays internal-only ───────────────

describe("max_position_size stays internal-only (no broker eligibility)", () => {
  const simSrc = readSrc("src/lib/guardian-engine/broker-enforcement-simulation.ts");

  it("BROKER_ELIGIBLE_RULES does not include max_position_size", () => {
    const match = simSrc.match(/BROKER_ELIGIBLE_RULES\s*=\s*new\s+Set\(\[([^\]]*)\]\)/);
    assert.ok(match, "BROKER_ELIGIBLE_RULES must be defined as a Set literal");
    const setContents = match![1];
    assert.ok(
      !setContents.includes("max_position_size"),
      `BROKER_ELIGIBLE_RULES must NOT include "max_position_size" — found: ${setContents}`,
    );
    assert.ok(
      setContents.includes("daily_loss_limit"),
      "BROKER_ELIGIBLE_RULES must include daily_loss_limit (existing scope)",
    );
  });

  it("simulation rejects non-eligible rule types (gates max_position_size)", () => {
    assert.ok(
      simSrc.includes("BROKER_ELIGIBLE_RULES.has(input.ruleType)"),
      "simulation must gate on BROKER_ELIGIBLE_RULES.has(input.ruleType) so max_position_size is rejected",
    );
  });
});

// ── reset-session-state clears max_position_size locks ───────────────────────

describe("reset-session-state clears max_position_size locks (no ruleType filter)", () => {
  const resetSrc = readSrc(
    "src/app/api/debug/accounts/[accountId]/reset-session-state/route.ts",
  );

  it("uses internalLockEvent.updateMany to clear all active locks", () => {
    assert.ok(
      resetSrc.includes("internalLockEvent.updateMany"),
      "reset must use updateMany to clear all active locks for the account",
    );
  });

  it("does not filter by ruleType — so daily_loss_limit, trade_limit, max_loss_streak, max_position_size all clear", () => {
    const idx = resetSrc.indexOf("internalLockEvent.updateMany");
    assert.ok(idx > -1);
    const slice = resetSrc.slice(idx, idx + 400);
    assert.ok(
      !slice.includes("ruleType"),
      "reset updateMany must not filter by ruleType — all active rule types must clear, including max_position_size",
    );
  });

  it("clears activeDedupKey so a max_position_size lock can re-fire same day after reset", () => {
    assert.ok(
      resetSrc.includes("activeDedupKey: null"),
      "reset must null out activeDedupKey so the max_position_size slot can be reused after manual reset",
    );
  });
});

// ── Sync-path wiring source-scan ─────────────────────────────────────────────

describe("tradovate-sync wires the max_position_size internal lock", () => {
  const syncSrc = readSrc("src/lib/brokers/tradovate-sync.ts");

  it("imports applyInternalLockForMaxPositionSize from the new module", () => {
    assert.ok(
      syncSrc.includes("applyInternalLockForMaxPositionSize"),
      "tradovate-sync must call applyInternalLockForMaxPositionSize so the sync path persists the InternalLockEvent",
    );
    assert.ok(
      syncSrc.includes("max-position-size-internal-lock-db"),
      "tradovate-sync must import from the max-position-size-internal-lock-db module",
    );
  });

  it("selects brokerConnection.env so the lock can apply its demo-only gate", () => {
    assert.ok(
      syncSrc.match(/brokerConnection:\s*\{\s*select:\s*\{[^}]*\benv:\s*true/),
      "sync's connection select must include env so the lock helper can enforce env=demo",
    );
  });

  it("invokes the lock when enforcementTrigger is max_position_size", () => {
    // The call is gated on the enforcement cascade picking max_position_size
    // as the winning trigger. Look for a conditional that references both.
    const idx = syncSrc.indexOf("applyInternalLockForMaxPositionSize");
    assert.ok(idx > -1, "sync must call applyInternalLockForMaxPositionSize");
    const surrounding = syncSrc.slice(Math.max(0, idx - 300), idx + 300);
    assert.ok(
      surrounding.includes("max_position_size") || surrounding.includes("maxPositionSize"),
      "the call must be gated by max_position_size enforcement context",
    );
  });
});
