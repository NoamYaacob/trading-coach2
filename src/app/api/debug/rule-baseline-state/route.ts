import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * Diagnostic endpoint: why does the account-specific Trading Plan pending
 * panel render "Max position size: — → N" instead of "X → N"?
 *
 * Usage:
 *   GET /api/debug/rule-baseline-state
 *
 * Auth: requires a valid session — only returns the requesting user's own
 * RiskRules + AccountRiskRules. No public exposure, no other users' data.
 *
 * Returns the exact column values that feed the pending diff baseline so
 * the caller can confirm whether `—` is a data state (both columns null)
 * or a code regression. Output is intentionally minimal: the maxContracts
 * column on RiskRules and on every AccountRiskRules row, plus the
 * pendingPayloadJson maxContracts key for context.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [riskRules, accounts] = await Promise.all([
    prisma.riskRules.findUnique({
      where: { userId: user.id },
      select: {
        userId: true,
        maxContracts: true,
        maxDailyLoss: true,
        riskPerTrade: true,
        maxRiskPerTrade: true,
        maxTradesPerDay: true,
        stopAfterLosses: true,
        sessionEndHour: true,
        // Default template can also defer saves into pendingPayloadJson when
        // the user is locked out (mid-session). When that happens the active
        // column stays null but the form may still display the typed value
        // from local state, leading users to believe the value is active when
        // it isn't. Surfacing the default's pending payload here lets the
        // caller distinguish "actually configured" from "saved but not yet
        // promoted" without having to dump pendingPayloadJson by hand.
        pendingPayloadJson: true,
        pendingEffectiveDate: true,
      },
    }),
    prisma.connectedAccount.findMany({
      where: { userId: user.id, isActive: true, missingFromBrokerSince: null },
      select: {
        id: true,
        label: true,
        externalAccountId: true,
        riskRules: {
          select: {
            accountId: true,
            maxContracts: true,
            maxDailyLoss: true,
            riskPerTrade: true,
            maxTradesPerDay: true,
            stopAfterLosses: true,
            allowedEndHour: true,
            pendingPayloadJson: true,
            pendingEffectiveDate: true,
          },
        },
      },
      orderBy: { label: "asc" },
    }),
  ]);

  /** Extract a single key from a pendingPayloadJson value, returning null
   *  when the payload is missing, non-object, or the key is absent. */
  function pendingKey(payload: unknown, key: string): unknown {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    return (payload as Record<string, unknown>)[key] ?? null;
  }

  // Surface the maxContracts key from pendingPayloadJson explicitly so the
  // caller doesn't have to reason about JSON shape.
  const accountsView = accounts.map((a) => ({
    id: a.id,
    label: a.label,
    externalAccountId: a.externalAccountId,
    accountRiskRules: a.riskRules
      ? {
          maxContracts: a.riskRules.maxContracts,
          maxDailyLoss: a.riskRules.maxDailyLoss,
          riskPerTrade: a.riskRules.riskPerTrade,
          maxTradesPerDay: a.riskRules.maxTradesPerDay,
          stopAfterLosses: a.riskRules.stopAfterLosses,
          allowedEndHour: a.riskRules.allowedEndHour,
          pendingMaxContracts: pendingKey(a.riskRules.pendingPayloadJson, "maxContracts"),
          pendingEffectiveDate: a.riskRules.pendingEffectiveDate,
        }
      : null,
  }));

  return NextResponse.json({
    ok: true,
    userId: user.id,
    defaultRiskRules: riskRules
      ? {
          maxContracts: riskRules.maxContracts,
          maxDailyLoss: riskRules.maxDailyLoss,
          riskPerTrade: riskRules.riskPerTrade,
          maxRiskPerTrade: riskRules.maxRiskPerTrade,
          maxTradesPerDay: riskRules.maxTradesPerDay,
          stopAfterLosses: riskRules.stopAfterLosses,
          sessionEndHour: riskRules.sessionEndHour,
          // Default-template pending payload — distinguishes "actually saved"
          // from "saved as pending, awaiting promotion".
          pendingMaxContracts: pendingKey(riskRules.pendingPayloadJson, "maxContracts"),
          pendingEffectiveDate: riskRules.pendingEffectiveDate,
        }
      : null,
    accounts: accountsView,
  });
}
