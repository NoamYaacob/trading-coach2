/**
 * Phase 2B extension: internal-lock DB persistence for max_position_size breaches.
 *
 * Background:
 *   The sync path (syncTradovateAccount) is the only Guardrail code path with
 *   access to current open-position data — the listener-worker's WebSocket
 *   props events carry P&L and trade counts but NOT position size. As a
 *   result, the listener's applyInternalLockForConnection cannot evaluate
 *   max_position_size. This module fills that gap from the sync path so a
 *   max_position_size breach produces an InternalLockEvent row alongside the
 *   existing GuardianIntervention.
 *
 * Safety contract (internal-only — NO broker side-effects):
 *   - Only applies to demo accounts (env === "demo")
 *   - Only active when GUARDRAIL_INTERNAL_LOCK_ENABLED=true
 *   - Only writes InternalLockEvent rows (LiveSessionState.riskState=STOPPED
 *     is set by the sync path independently of this module)
 *   - Never calls Tradovate write APIs
 *   - Never flattens positions, cancels orders, or places orders
 *   - Never writes broker risk settings
 *   - Never touches live accounts (env="live" returns early with a skip reason)
 *   - Idempotent: dedup key prevents duplicate rows on repeated sync cycles
 *
 * Broker-eligibility:
 *   max_position_size is NOT in BROKER_ELIGIBLE_RULES — the broker enforcement
 *   simulation gate rejects it before any Tradovate write. This module never
 *   invokes that path.
 *
 * Pure evaluator semantics for max_position_size live in
 * max-position-size-internal-lock-evaluator.ts (re-exported here for callers).
 */

import { prisma } from "../db";
import { buildInternalLockDedupKey } from "./internal-lock-evaluator";

export {
  evaluateMaxPositionSizeForLock,
  type MaxPositionSizeLockEvalInput,
  type MaxPositionSizeLockEvalResult,
} from "./max-position-size-internal-lock-evaluator";

// ── DB persistence ────────────────────────────────────────────────────────────

export type MaxPositionSizeLockInput = {
  accountId: string;
  userId: string;
  /** "demo" | "live" — locked behavior only applies when env === "demo". */
  env: string;
  /** YYYY-MM-DD trading day key (CME session date in CT). */
  tradingDay: string;
  /** Configured max contracts (standard-equivalent units). */
  maxContracts: number;
  /** Observed standard-equivalent exposure that triggered the breach. */
  currentMiniEquivalentExposure: number;
};

export type MaxPositionSizeLockResult = {
  internalLockEventId: string | null;
  /** Human-readable skip reason. Null when a lock row was upserted. */
  skipReason: string | null;
  /** True when an InternalLockEvent row was created or refreshed. */
  createdOrUpdated: boolean;
};

/**
 * Upsert an InternalLockEvent for a max_position_size breach detected by the
 * sync path. Demo-only and feature-flagged.
 *
 * Writes:
 *   - InternalLockEvent row (ruleType="max_position_size", internalOnly=true,
 *     brokerActionTaken=false)
 *
 * Never writes:
 *   - LiveSessionState.riskState (the sync path sets STOPPED separately)
 *   - GuardianIntervention (the sync path triggers enforcement separately)
 *   - Broker risk settings, orders, flatten requests, or any Tradovate call
 */
export async function applyInternalLockForMaxPositionSize(
  input: MaxPositionSizeLockInput,
): Promise<MaxPositionSizeLockResult> {
  if (process.env.GUARDRAIL_INTERNAL_LOCK_ENABLED !== "true") {
    return {
      internalLockEventId: null,
      skipReason: "GUARDRAIL_INTERNAL_LOCK_ENABLED is not 'true'",
      createdOrUpdated: false,
    };
  }
  if (input.env !== "demo") {
    return {
      internalLockEventId: null,
      skipReason: `env="${input.env}" (must be demo)`,
      createdOrUpdated: false,
    };
  }

  const activeDedupKey = buildInternalLockDedupKey(
    input.accountId,
    "max_position_size",
    input.tradingDay,
  );

  console.info("[guardian] applying max_position_size internal lock — demo only, no broker action", {
    accountId: input.accountId,
    tradingDay: input.tradingDay,
    activeDedupKey,
    observedMiniEquivalentExposure: input.currentMiniEquivalentExposure,
    thresholdMaxContracts: input.maxContracts,
  });

  // Idempotent upsert: repeated sync cycles for the same breach hit the
  // activeDedupKey unique constraint and update observedAmount/updatedAt
  // instead of inserting a duplicate. observedAmount uses Decimal so
  // fractional standard-equivalent exposures (e.g. 0.5 = 5 MNQ) are preserved.
  const lockEvent = await prisma.internalLockEvent.upsert({
    where: { activeDedupKey },
    create: {
      accountId: input.accountId,
      userId: input.userId,
      ruleType: "max_position_size",
      tradingDay: input.tradingDay,
      thresholdAmount: null,
      thresholdCount: input.maxContracts,
      observedAmount: input.currentMiniEquivalentExposure,
      observedCount: null,
      internalOnly: true,
      brokerActionTaken: false,
      activeDedupKey,
      updatedAt: new Date(),
    },
    update: {
      observedAmount: input.currentMiniEquivalentExposure,
      updatedAt: new Date(),
    },
  });

  return {
    internalLockEventId: lockEvent.id,
    skipReason: null,
    createdOrUpdated: true,
  };
}
