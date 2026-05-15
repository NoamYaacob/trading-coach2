/**
 * GET /api/debug/tradovate-listener/dry-run-evaluation-state
 *
 * Read-only diagnostic: for every account on an active listener connection,
 * explains exactly why Phase 2A dry-run violations are or are not firing.
 *
 * Safety:
 *   - Read-only — never writes DryRunViolation rows or any other DB row
 *   - No enforcement, no broker writes, no riskState mutations
 *   - Auth: x-cron-secret always required
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import {
  deriveAccountEvaluation,
  type AccountEvalInput,
} from "@/lib/guardian-engine/dry-run-evaluation-state-helpers";

export async function GET(request: NextRequest) {
  const secret = request.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const enableLive = process.env.TRADOVATE_LISTENER_ENABLE_LIVE === "true";

  // All accounts on connections with an active listener — include all protection
  // statuses so the response shows WHY each account is or isn't being evaluated.
  const accounts = await prisma.connectedAccount.findMany({
    where: {
      brokerConnection: {
        listenerStatus: { in: ["connected", "connecting", "reconnecting"] },
      },
    },
    select: {
      id: true,
      userId: true,
      label: true,
      externalAccountId: true,
      protectionStatus: true,
      isActive: true,
      missingFromBrokerSince: true,
      brokerConnectionId: true,
      brokerConnection: {
        select: { id: true, env: true, listenerStatus: true },
      },
      sessionState: {
        select: {
          sessionDate: true,
          dailyPnl: true,
          tradesCount: true,
          tradeCountSource: true,
          consecutiveLosses: true,
          updatedAt: true,
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
    orderBy: { label: "asc" },
  });

  let wouldFireCount = 0;
  let skippedAccounts = 0;

  const evaluatedAccounts = accounts.map((account) => {
    const env = account.brokerConnection?.env ?? "demo";
    const session = account.sessionState;
    const rules = account.riskRules;

    const sessionView = session
      ? {
          exists: true as const,
          sessionDate: session.sessionDate,
          dailyPnl: Number(session.dailyPnl),
          tradesCount: session.tradesCount,
          tradeCountSource: session.tradeCountSource,
          consecutiveLosses: session.consecutiveLosses,
          updatedAt: session.updatedAt,
        }
      : { exists: false as const };

    const rulesView = rules
      ? {
          exists: true as const,
          maxDailyLoss: rules.maxDailyLoss != null ? Number(rules.maxDailyLoss) : null,
          maxTradesPerDay: rules.maxTradesPerDay ?? null,
          stopAfterLosses: rules.stopAfterLosses ?? null,
        }
      : { exists: false as const };

    const evalInput: AccountEvalInput = {
      accountId: account.id,
      userId: account.userId,
      externalAccountId: account.externalAccountId,
      env,
      isActive: account.isActive,
      missingFromBrokerSince: account.missingFromBrokerSince,
      protectionStatus: account.protectionStatus,
      sessionState: session
        ? {
            sessionDate: session.sessionDate,
            dailyPnl: Number(session.dailyPnl),
            tradesCount: session.tradesCount,
            tradeCountSource: session.tradeCountSource,
            consecutiveLosses: session.consecutiveLosses,
            updatedAt: session.updatedAt,
          }
        : null,
      riskRules: rules
        ? {
            maxDailyLoss: rules.maxDailyLoss != null ? Number(rules.maxDailyLoss) : null,
            maxTradesPerDay: rules.maxTradesPerDay ?? null,
            stopAfterLosses: rules.stopAfterLosses ?? null,
          }
        : null,
      enableLive,
    };

    const { evaluationEligible, ruleEvaluation, wouldFire } = deriveAccountEvaluation(evalInput);

    if (!evaluationEligible) skippedAccounts++;
    if (wouldFire) wouldFireCount++;

    return {
      accountId: account.id,
      label: account.label,
      externalAccountId: account.externalAccountId,
      brokerConnectionId: account.brokerConnectionId,
      env,
      listenerStatus: account.brokerConnection?.listenerStatus ?? null,
      protectionStatus: account.protectionStatus,
      isActive: account.isActive,
      evaluationEligible,
      sessionState: sessionView,
      rules: rulesView,
      ruleEvaluation,
    };
  });

  return NextResponse.json({
    note: "Dry-run evaluation only — no violations written and no enforcement action was taken.",
    dryRunEnabled: process.env.ENFORCEMENT_DRY_RUN === "true",
    evaluatedAccounts,
    wouldFireCount,
    skippedAccounts,
  });
}
