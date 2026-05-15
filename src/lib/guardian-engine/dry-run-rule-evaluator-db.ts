/**
 * Phase 2A: DB persistence and connection-level entry point for dry-run rule evaluation.
 *
 * Safety contract:
 *   - Only writes DryRunViolation rows (observe-only audit table)
 *   - Never reads or writes riskState, GuardianIntervention, or broker endpoints
 *   - dryRun=true always — this file must NEVER set dryRun=false
 *   - No flatten, cancel orders, or broker write calls
 */

import { prisma } from "../db";
import {
  evaluateDryRunRules,
  type DryRunRuleInput,
  type DryRunRuleResult,
} from "./dry-run-rule-evaluator";

/**
 * Upsert DryRunViolation rows for an account.
 * Idempotent — calling this multiple times with the same violations is safe.
 */
export async function persistDryRunViolations(
  input: DryRunRuleInput,
  violations: DryRunRuleResult[],
): Promise<void> {
  if (violations.length === 0) return;

  for (const v of violations) {
    await prisma.dryRunViolation.upsert({
      where: { dedupKey: v.dedupKey },
      update: {
        observedAmount: v.observedAmount,
        observedCount: v.observedCount,
        updatedAt: new Date(),
      },
      create: {
        userId: input.userId,
        accountId: input.accountId,
        externalAccountId: input.externalAccountId,
        env: input.env,
        ruleType: v.ruleType,
        thresholdAmount: v.thresholdAmount,
        thresholdCount: v.thresholdCount,
        observedAmount: v.observedAmount,
        observedCount: v.observedCount,
        sourceEventId: input.sourceEventId ?? null,
        dryRun: true,
        actionWouldHaveTaken: v.actionWouldHaveTaken,
        tradingDay: input.tradingDay,
        dedupKey: v.dedupKey,
        updatedAt: new Date(),
      },
    });
  }
}

/**
 * Load account state, evaluate dry-run rules, and persist violations.
 * Called from the worker's onPropsEvent callback when ENFORCEMENT_DRY_RUN=true.
 *
 * Safety: reads ConnectedAccount + LiveSessionState + AccountRiskRules only.
 * Never reads or writes riskState, GuardianIntervention, or broker endpoints.
 */
export async function evaluateDryRunRulesForConnection(connectionId: string): Promise<void> {
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

    // Phase 2A: demo only. Skip live accounts while TRADOVATE_LISTENER_ENABLE_LIVE=false.
    if (env === "live" && process.env.TRADOVATE_LISTENER_ENABLE_LIVE !== "true") continue;

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
    await persistDryRunViolations(input, violations);
  }
}
