import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { writeRuleChangeAudit } from "@/lib/rules/rule-change-audit-writer";
import { getAccountIdsWithTradeToday } from "@/lib/rules/session-trade-guard";
import { deriveCmeTradingDayKey } from "@/lib/trading-day";
import { getCmeSessionStartForKey } from "@/lib/time/cme-session";

type Ctx = { params: Promise<{ id: string }> };

// Fields copied from source AccountRiskRules → target AccountRiskRules.
// Excluded: id, accountId, createdAt, updatedAt (identity/DB-managed),
//           automatedActionsConsentAt/Version (per-account consent),
//           pendingPayloadJson/pendingEffectiveDate (account-specific pending state).
const COPY_FIELDS = [
  "maxDailyLoss",
  "riskPerTrade",
  "maxTradesPerDay",
  "stopAfterLosses",
  "allowedStartHour",
  "allowedEndHour",
  "sessionTimezone",
  "sessionEndBehavior",
  "sessionPreset",
  "sessionStartTime",
  "sessionEndTime",
  "sessionPresetsJson",
  "ruleEditLockBufferMinutes",
  "maxContracts",
  "maxContractsBySymbolJson",
  "rawBrokerHardLimitEnabled",
  "propFirmAccountSize",
  "propFirmPhase",
  "propFirmDailyLossLimit",
  "propFirmMaxDrawdown",
  "propFirmEODDrawdown",
  "propFirmTrailingDrawdown",
  "propFirmDrawdownRemaining",
  "propFirmProfitTarget",
  "propFirmMinTradingDays",
] as const;

type SourceRules = Awaited<
  ReturnType<typeof prisma.accountRiskRules.findUnique>
>;

// Scalar rule fields copied from source → target.
// Excludes identity (id, accountId), DB-managed (createdAt, updatedAt),
// per-account consent, and pending state.
type CopyData = Omit<
  Prisma.AccountRiskRulesUncheckedCreateInput,
  | "id"
  | "accountId"
  | "createdAt"
  | "updatedAt"
  | "automatedActionsConsentAt"
  | "automatedActionsConsentVersion"
  | "pendingPayloadJson"
  | "pendingEffectiveDate"
>;

function extractCopyData(sourceRules: NonNullable<SourceRules>): CopyData {
  return {
    maxDailyLoss: sourceRules.maxDailyLoss,
    riskPerTrade: sourceRules.riskPerTrade,
    maxTradesPerDay: sourceRules.maxTradesPerDay,
    stopAfterLosses: sourceRules.stopAfterLosses,
    allowedStartHour: sourceRules.allowedStartHour,
    allowedEndHour: sourceRules.allowedEndHour,
    sessionTimezone: sourceRules.sessionTimezone,
    sessionEndBehavior: sourceRules.sessionEndBehavior,
    sessionPreset: sourceRules.sessionPreset,
    sessionStartTime: sourceRules.sessionStartTime,
    sessionEndTime: sourceRules.sessionEndTime,
    sessionPresetsJson: sourceRules.sessionPresetsJson,
    ruleEditLockBufferMinutes: sourceRules.ruleEditLockBufferMinutes,
    maxContracts: sourceRules.maxContracts,
    maxContractsBySymbolJson: sourceRules.maxContractsBySymbolJson,
    rawBrokerHardLimitEnabled: sourceRules.rawBrokerHardLimitEnabled,
    propFirmAccountSize: sourceRules.propFirmAccountSize,
    propFirmPhase: sourceRules.propFirmPhase,
    propFirmDailyLossLimit: sourceRules.propFirmDailyLossLimit,
    propFirmMaxDrawdown: sourceRules.propFirmMaxDrawdown,
    propFirmEODDrawdown: sourceRules.propFirmEODDrawdown,
    propFirmTrailingDrawdown: sourceRules.propFirmTrailingDrawdown,
    propFirmDrawdownRemaining: sourceRules.propFirmDrawdownRemaining,
    propFirmProfitTarget: sourceRules.propFirmProfitTarget,
    propFirmMinTradingDays: sourceRules.propFirmMinTradingDays,
  };
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  const body = (await req.json()) as { sourceAccountId?: unknown };
  const sourceAccountId = body.sourceAccountId;

  if (!sourceAccountId || typeof sourceAccountId !== "string") {
    return NextResponse.json({ error: "sourceAccountId required" }, { status: 400 });
  }

  if (sourceAccountId === id) {
    return NextResponse.json({ error: "cannot_copy_to_self" }, { status: 400 });
  }

  // Ownership: both accounts must belong to the current user.
  const [targetAccount, sourceAccount] = await Promise.all([
    prisma.connectedAccount.findFirst({
      where: { id, userId: currentUser.id },
    }),
    prisma.connectedAccount.findFirst({
      where: { id: sourceAccountId, userId: currentUser.id },
    }),
  ]);

  if (!targetAccount) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!sourceAccount) {
    return NextResponse.json({ error: "source_not_found" }, { status: 404 });
  }

  const sourceRules = await prisma.accountRiskRules.findUnique({
    where: { accountId: sourceAccountId },
  });
  if (!sourceRules) {
    return NextResponse.json({ error: "source_has_no_rules" }, { status: 422 });
  }

  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;

  // Session lock check — all 3 signals, no first-time-setup exemption.
  // Copying rules after trading has started could change active monitoring.
  const tradingDayKey = deriveCmeTradingDayKey(new Date());
  const sessionStart = getCmeSessionStartForKey(tradingDayKey);

  const [liveState, accountsWithTrades] = await Promise.all([
    prisma.liveSessionState.findUnique({
      where: { accountId: id },
      select: { riskState: true, tradesCount: true, sessionDate: true, lastTradeAt: true },
    }),
    getAccountIdsWithTradeToday([id], sessionStart),
  ]);

  const liveStateHasTraded =
    (liveState?.sessionDate === tradingDayKey && (liveState?.tradesCount ?? 0) > 0) ||
    (liveState?.lastTradeAt != null &&
      deriveCmeTradingDayKey(liveState.lastTradeAt) === tradingDayKey);
  const hasTradeEventToday = accountsWithTrades.has(id);

  if (liveStateHasTraded || hasTradeEventToday) {
    await writeRuleChangeAudit({
      userId: currentUser.id,
      accountId: id,
      scope: "account",
      newValuesJson: { _copiedFromAccountId: sourceAccountId },
      allowed: false,
      reason: "session_already_traded",
      blockReason: "session_already_traded",
      sessionRiskState: liveState?.riskState ?? null,
      ip,
      userAgent,
    });
    return NextResponse.json(
      {
        error: "session_already_traded",
        message:
          "Rules are locked for this session — this account has already traded. Changes can be made after the session resets.",
      },
      { status: 423 },
    );
  }

  const copyData = extractCopyData(sourceRules);

  await prisma.accountRiskRules.upsert({
    where: { accountId: id },
    create: {
      accountId: id,
      ...copyData,
      pendingPayloadJson: Prisma.JsonNull,
      pendingEffectiveDate: null,
    } satisfies Prisma.AccountRiskRulesUncheckedCreateInput,
    update: {
      ...copyData,
      pendingPayloadJson: Prisma.JsonNull,
      pendingEffectiveDate: null,
    } satisfies Prisma.AccountRiskRulesUncheckedUpdateInput,
  });

  await writeRuleChangeAudit({
    userId: currentUser.id,
    accountId: id,
    scope: "account",
    newValuesJson: { ...copyData, _copiedFromAccountId: sourceAccountId },
    allowed: true,
    reason: "copied_from_account",
    ip,
    userAgent,
  });

  return NextResponse.json({
    ok: true,
    copiedFrom: sourceAccountId,
    targetAccountId: id,
    message: "Trading Plan copied successfully.",
  });
}
