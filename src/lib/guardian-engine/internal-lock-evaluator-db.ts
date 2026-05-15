/**
 * Phase 2B: DB persistence and connection-level entry point for internal app lock.
 * Phase 2C-E: now returns structured results so the listener can pass lock event
 * IDs to the broker enforcement service without an extra DB round-trip.
 *
 * Safety contract:
 *   - Only applies to demo accounts (env === "demo")
 *   - Only active when GUARDRAIL_INTERNAL_LOCK_ENABLED=true
 *   - Only writes LiveSessionState.riskState and InternalLockEvent rows
 *   - Never calls Tradovate write APIs
 *   - Never flattens positions, cancels orders, or places orders
 *   - Never touches live accounts while TRADOVATE_LISTENER_ENABLE_LIVE=false
 *   - Idempotent: accounts already at riskState=STOPPED are skipped
 */

import { prisma } from "../db";
import { evaluateDryRunRules, type DryRunRuleInput } from "./dry-run-rule-evaluator";
import { canApplyInternalLock, buildInternalLockDedupKey } from "./internal-lock-evaluator";

/** Per-account outcome from a single applyInternalLockForConnection call. */
export type InternalLockResult = {
  accountId: string;
  /** True when a lock row was created or refreshed (upsert updated) this cycle. */
  createdOrUpdated: boolean;
  /**
   * ID of the InternalLockEvent that was created or updated.
   * Null when the account was skipped for any reason.
   * Passed directly to maybeAttemptBrokerDailyLossLockoutForInternalLock
   * by the listener when BROKER_ENFORCEMENT_ENABLED=true.
   */
  internalLockEventId: string | null;
  /** Primary rule type of the violation. Null when no violation found. */
  ruleType: string | null;
  /** Human-readable reason the lock step was skipped. Null when lock was applied. */
  skipReason: string | null;
};

/**
 * Evaluate rules and apply an internal app lock to any demo account in breach.
 * Called from the worker's onPropsEvent when GUARDRAIL_INTERNAL_LOCK_ENABLED=true.
 *
 * Returns one InternalLockResult per eligible account on the connection.
 * Returns [] when the feature flag is off or no eligible accounts exist.
 *
 * Writes:
 *   - LiveSessionState.riskState = "STOPPED"    (on the breaching account)
 *   - InternalLockEvent row                     (audit trail, internalOnly=true)
 *
 * Never writes:
 *   - GuardianIntervention rows
 *   - Broker risk settings
 *   - Any Tradovate endpoint
 */
export async function applyInternalLockForConnection(connectionId: string): Promise<InternalLockResult[]> {
  if (process.env.GUARDRAIL_INTERNAL_LOCK_ENABLED !== "true") return [];

  const accounts = await prisma.connectedAccount.findMany({
    where: {
      brokerConnectionId: connectionId,
      isActive: true,
      protectionStatus: "protected",
    },
    select: {
      id: true,
      userId: true,
      externalAccountId: true,
      brokerConnection: { select: { env: true } },
      sessionState: {
        select: {
          riskState: true,
          dailyPnl: true,
          tradesCount: true,
          tradeCountSource: true,
          consecutiveLosses: true,
          sessionDate: true,
        },
      },
      riskRules: {
        select: {
          maxDailyLoss: true,
          maxTradesPerDay: true,
          stopAfterLosses: true,
        },
      },
    },
  });

  if (accounts.length === 0) return [];

  const today = new Date().toISOString().slice(0, 10);
  const results: InternalLockResult[] = [];

  for (const account of accounts) {
    const session = account.sessionState;
    if (!session) {
      results.push({ accountId: account.id, createdOrUpdated: false, internalLockEventId: null, ruleType: null, skipReason: "no LiveSessionState row" });
      continue;
    }

    const rules = account.riskRules;
    if (!rules) {
      results.push({ accountId: account.id, createdOrUpdated: false, internalLockEventId: null, ruleType: null, skipReason: "no AccountRiskRules row" });
      continue;
    }

    const env = account.brokerConnection?.env ?? "demo";

    if (
      !canApplyInternalLock({
        env,
        riskState: session.riskState,
        flagEnabled: true, // already checked at top of function
      })
    ) {
      if (env !== "demo") {
        results.push({
          accountId: account.id,
          createdOrUpdated: false,
          internalLockEventId: null,
          ruleType: null,
          skipReason: `env="${env}" (must be demo)`,
        });
        continue;
      }
      // Account is already STOPPED. Look up the existing active lock so broker
      // enforcement can be attempted for locks created before BROKER_ENFORCEMENT_ENABLED
      // was flipped on. The broker enforcement service's dedup gate prevents a
      // duplicate GuardianIntervention from being written if enforcement already ran.
      const existingLock = await prisma.internalLockEvent.findFirst({
        where: {
          accountId: account.id,
          clearedAt: null,
          activeDedupKey: { not: null },
        },
        select: { id: true, ruleType: true },
        orderBy: { createdAt: "desc" },
      });
      results.push({
        accountId: account.id,
        createdOrUpdated: false,
        internalLockEventId: existingLock?.id ?? null,
        ruleType: existingLock?.ruleType ?? null,
        skipReason: `riskState="${session.riskState}" (already STOPPED — idempotent skip)`,
      });
      continue;
    }

    const tradingDay = session.sessionDate ?? today;

    const input: DryRunRuleInput = {
      accountId: account.id,
      userId: account.userId,
      externalAccountId: account.externalAccountId ?? null,
      env,
      tradingDay,
      dailyPnl: Number(session.dailyPnl),
      tradesCount: session.tradesCount,
      tradeCountSource: session.tradeCountSource,
      consecutiveLosses: session.consecutiveLosses,
      maxDailyLoss: rules.maxDailyLoss != null ? Number(rules.maxDailyLoss) : null,
      maxTradesPerDay: rules.maxTradesPerDay ?? null,
      stopAfterLosses: rules.stopAfterLosses ?? null,
    };

    const { violations } = evaluateDryRunRules(input);
    if (violations.length === 0) {
      results.push({ accountId: account.id, createdOrUpdated: false, internalLockEventId: null, ruleType: null, skipReason: "no violations detected" });
      continue;
    }

    // Primary violation: first by evaluation order (daily_loss_limit > trade_limit > max_loss_streak).
    const primary = violations[0];

    // One active lock per account + rule + day. The activeDedupKey unique
    // constraint is the DB-level race guard: concurrent props events that
    // race past the riskState check produce a single row — the second
    // upsert updates observedAmount/updatedAt on the first row instead of
    // inserting a duplicate.
    const activeDedupKey = buildInternalLockDedupKey(
      account.id,
      primary.ruleType,
      tradingDay,
    );

    console.info("[guardian] applying internal lock — demo only, no broker action", {
      accountId: account.id,
      ruleType: primary.ruleType,
      tradingDay,
      activeDedupKey,
    });

    // Capture the upsert result so its id can be returned to the caller.
    // On create: new row id. On update (conflict on activeDedupKey): same id
    // as the existing row — the broker enforcement service uses it for dedup.
    const [, lockEvent] = await prisma.$transaction([
      prisma.liveSessionState.update({
        where: { accountId: account.id },
        data: { riskState: "STOPPED" },
      }),
      prisma.internalLockEvent.upsert({
        where: { activeDedupKey },
        create: {
          accountId: account.id,
          userId: account.userId,
          ruleType: primary.ruleType,
          tradingDay,
          thresholdAmount: primary.thresholdAmount,
          thresholdCount: primary.thresholdCount,
          observedAmount: primary.observedAmount,
          observedCount: primary.observedCount,
          internalOnly: true,
          brokerActionTaken: false,
          activeDedupKey,
          updatedAt: new Date(),
        },
        update: {
          // Refresh observed values on re-trigger (threshold and rule identity are stable).
          observedAmount: primary.observedAmount,
          observedCount: primary.observedCount,
          updatedAt: new Date(),
        },
      }),
    ]);

    results.push({
      accountId: account.id,
      createdOrUpdated: true,
      internalLockEventId: lockEvent.id,
      ruleType: primary.ruleType,
      skipReason: null,
    });
  }

  return results;
}
