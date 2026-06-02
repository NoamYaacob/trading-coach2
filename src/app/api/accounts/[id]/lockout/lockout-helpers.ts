/**
 * Pure helpers for the manual same-day account lockout.
 *
 * Side-effect-free: no Prisma, no DB, no broker calls. Builds the exact
 * payloads the POST /api/accounts/[id]/lockout route hands to a
 * prisma.$transaction([liveSessionState.upsert, internalLockEvent.upsert]).
 *
 * Extracted so the lock's critical invariants — CME-day scoping, per-account
 * dedup key, STOPPED risk state, internal-only (no broker action) — are unit
 * testable without a database.
 */

import { buildInternalLockDedupKey } from "../../../../../lib/guardian-engine/internal-lock-evaluator.ts";
import { deriveCmeTradingDayKey } from "../../../../../lib/trading-day.ts";

/**
 * ruleType stored on the InternalLockEvent for a user-initiated lock. A plain
 * string (the column is not an enum) so no schema migration is required, and
 * distinct from the rule-engine rule types so manual locks never collide with
 * an automatic daily_loss_limit / trade_limit / max_loss_streak lock.
 */
export const MANUAL_LOCK_RULE_TYPE = "manual_lock";

export type ManualLockoutPlan = {
  /** CME trading-day key (America/Chicago, rolls at 17:00 CT). */
  tradingDay: string;
  /** Unique key — one active manual lock per account per CME day. */
  activeDedupKey: string;
  liveSessionState: {
    create: { accountId: string; sessionDate: string; riskState: "STOPPED" };
    update: { riskState: "STOPPED" };
  };
  internalLockEvent: {
    create: {
      accountId: string;
      userId: string;
      ruleType: string;
      tradingDay: string;
      internalOnly: true;
      brokerActionTaken: false;
      activeDedupKey: string;
      updatedAt: Date;
    };
    update: { updatedAt: Date };
  };
};

/**
 * Build the upsert payloads for a manual lockout. Deterministic for a given
 * (accountId, userId, now): two calls in the same CME session produce the same
 * activeDedupKey, so the DB unique constraint makes repeated clicks idempotent
 * rather than creating duplicate active locks.
 */
export function buildManualLockoutPlan(input: {
  accountId: string;
  userId: string;
  /** Defaults to new Date(). Injectable for deterministic tests. */
  now?: Date;
}): ManualLockoutPlan {
  const now = input.now ?? new Date();
  const tradingDay = deriveCmeTradingDayKey(now);
  const activeDedupKey = buildInternalLockDedupKey(
    input.accountId,
    MANUAL_LOCK_RULE_TYPE,
    tradingDay,
  );

  return {
    tradingDay,
    activeDedupKey,
    liveSessionState: {
      create: { accountId: input.accountId, sessionDate: tradingDay, riskState: "STOPPED" },
      update: { riskState: "STOPPED" },
    },
    internalLockEvent: {
      create: {
        accountId: input.accountId,
        userId: input.userId,
        ruleType: MANUAL_LOCK_RULE_TYPE,
        tradingDay,
        internalOnly: true,
        brokerActionTaken: false,
        activeDedupKey,
        updatedAt: now,
      },
      update: { updatedAt: now },
    },
  };
}
