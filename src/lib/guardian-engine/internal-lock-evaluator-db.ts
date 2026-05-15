/**
 * Phase 2B: DB persistence and connection-level entry point for internal app lock.
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
import { canApplyInternalLock } from "./internal-lock-evaluator";

/**
 * Evaluate rules and apply an internal app lock to any demo account in breach.
 * Called from the worker's onPropsEvent when GUARDRAIL_INTERNAL_LOCK_ENABLED=true.
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
export async function applyInternalLockForConnection(connectionId: string): Promise<void> {
  if (process.env.GUARDRAIL_INTERNAL_LOCK_ENABLED !== "true") return;

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

  if (accounts.length === 0) return;

  const today = new Date().toISOString().slice(0, 10);

  for (const account of accounts) {
    const session = account.sessionState;
    if (!session) continue;

    const rules = account.riskRules;
    if (!rules) continue;

    const env = account.brokerConnection?.env ?? "demo";

    if (
      !canApplyInternalLock({
        env,
        riskState: session.riskState,
        flagEnabled: true, // already checked at top of function
      })
    ) {
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
    if (violations.length === 0) continue;

    // Primary violation: first by evaluation order (daily_loss_limit > trade_limit > max_loss_streak).
    const primary = violations[0];

    console.info("[guardian] applying internal lock — demo only, no broker action", {
      accountId: account.id,
      ruleType: primary.ruleType,
      tradingDay,
    });

    await prisma.$transaction([
      prisma.liveSessionState.update({
        where: { accountId: account.id },
        data: { riskState: "STOPPED" },
      }),
      prisma.internalLockEvent.create({
        data: {
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
          updatedAt: new Date(),
        },
      }),
    ]);
  }
}
