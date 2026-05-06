import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  buildDisconnectUpdate,
  buildNoRevocationResult,
  platformHasRevocationEndpoint,
} from "@/lib/brokers/tradovate-disconnect";
import { getProtectionLockState } from "@/lib/account-protection";
import { type RiskRulesBody, riskRulesData } from "./risk-rules-data";

type Ctx = { params: Promise<{ id: string }> };

const VALID_PLATFORMS = ["tradovate", "tradingview", "manual"] as const;
const VALID_ACCOUNT_TYPES = ["evaluation", "funded", "personal", "demo"] as const;

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  const existing = await prisma.connectedAccount.findFirst({
    where: { id, userId: currentUser.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const body = (await req.json()) as {
    label?: string;
    platform?: string;
    propFirm?: string | null;
    accountType?: string;
    externalAccountId?: string | null;
    currency?: string;
    isActive?: boolean;
    riskRules?: RiskRulesBody | null;
  };

  const platform = VALID_PLATFORMS.includes(body.platform as (typeof VALID_PLATFORMS)[number])
    ? (body.platform as (typeof VALID_PLATFORMS)[number])
    : undefined;

  const accountType = VALID_ACCOUNT_TYPES.includes(
    body.accountType as (typeof VALID_ACCOUNT_TYPES)[number],
  )
    ? (body.accountType as (typeof VALID_ACCOUNT_TYPES)[number])
    : undefined;

  // Block deactivating a protected/monitor-only account while the session is locked.
  // Bypass for unavailable accounts (missingFromBrokerSince is set) and ignored accounts —
  // there is no active monitoring to disrupt.
  const isUnavailableForDeactivation =
    existing.missingFromBrokerSince != null ||
    existing.protectionStatus === "ignored" ||
    existing.protectionStatus === "archived";
  if (
    !isUnavailableForDeactivation &&
    body.isActive === false &&
    (existing.protectionStatus === "protected" || existing.protectionStatus === "monitor_only")
  ) {
    const userRules = await prisma.riskRules.findUnique({
      where: { userId: currentUser.id },
      select: { sessionStartHour: true, sessionEndHour: true, protectionLockCutoffMinutes: true },
    });
    const lock = getProtectionLockState({
      sessionStartHour: userRules?.sessionStartHour ?? null,
      sessionEndHour: userRules?.sessionEndHour ?? null,
      cutoffMinutes: userRules?.protectionLockCutoffMinutes ?? null,
    });
    if (lock.isLocked) {
      return NextResponse.json(
        {
          error: "protection_locked",
          message:
            "This account is protected during today's trading session. Deactivating is blocked until the session ends.",
        },
        { status: 409 },
      );
    }
  }

  const account = await prisma.connectedAccount.update({
    where: { id },
    data: {
      ...(body.label !== undefined && { label: body.label }),
      ...(platform !== undefined && { platform }),
      ...(body.propFirm !== undefined && { propFirm: body.propFirm }),
      ...(accountType !== undefined && { accountType }),
      ...(body.externalAccountId !== undefined && {
        externalAccountId: body.externalAccountId?.trim() || null,
        // Keep live status if already connected — only walk back if ID is cleared.
        ...(existing.connectionStatus !== "connected_live"
          ? { connectionStatus: body.externalAccountId?.trim() ? "pending_webhook" : "not_connected" }
          : !body.externalAccountId?.trim()
            ? { connectionStatus: "not_connected", connectedAt: null }
            : {}),
      }),
      ...(body.currency !== undefined && { currency: body.currency }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
    },
  });

  let rulesLockResult:
    | { applied: false; reason: "protection_locked"; effectiveDate: string; message: string }
    | null = null;

  if (body.riskRules !== undefined) {
    // Check the user's protection-lock state before mutating account rules.
    const [userRules, existingAccountRules] = await Promise.all([
      prisma.riskRules.findUnique({
        where: { userId: currentUser.id },
        select: {
          sessionStartHour: true,
          sessionEndHour: true,
          protectionLockCutoffMinutes: true,
        },
      }),
      prisma.accountRiskRules.findUnique({
        where: { accountId: id },
        select: { accountId: true },
      }),
    ]);
    const lock = getProtectionLockState({
      sessionStartHour: userRules?.sessionStartHour ?? null,
      sessionEndHour: userRules?.sessionEndHour ?? null,
      cutoffMinutes: userRules?.protectionLockCutoffMinutes ?? null,
    });
    // First-time setup (no existing account-specific rules) bypasses the lock:
    // there are no active account rules to weaken, so the change is safe immediately.
    const isFirstTimeSetup = !existingAccountRules;

    if (lock.isLocked && !isFirstTimeSetup) {
      // Save the requested change as a pending payload that will apply on
      // the next trading day. Do NOT mutate AccountRiskRules columns now.
      const payload =
        body.riskRules === null ? { __delete: true } : riskRulesData(body.riskRules);
      await prisma.accountRiskRules.upsert({
        where: { accountId: id },
        create: {
          accountId: id,
          pendingPayloadJson: payload as Prisma.InputJsonValue,
          pendingEffectiveDate: lock.nextTradingDayKey,
        },
        update: {
          pendingPayloadJson: payload as Prisma.InputJsonValue,
          pendingEffectiveDate: lock.nextTradingDayKey,
        },
      });
      rulesLockResult = {
        applied: false,
        reason: "protection_locked",
        effectiveDate: lock.nextTradingDayKey,
        message: "Today's rules are locked. These changes will apply next trading day.",
      };
    } else if (body.riskRules === null) {
      await prisma.accountRiskRules.deleteMany({ where: { accountId: id } });
    } else {
      const data = riskRulesData(body.riskRules);
      await prisma.accountRiskRules.upsert({
        where: { accountId: id },
        create: { accountId: id, ...data },
        update: {
          ...data,
          pendingPayloadJson: Prisma.JsonNull,
          pendingEffectiveDate: null,
        },
      });
    }
  }

  return NextResponse.json({ account, rulesLock: rulesLockResult });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  const existing = await prisma.connectedAccount.findFirst({
    where: { id, userId: currentUser.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Block disconnecting a protected account while the trading session is locked.
  // Bypass for unavailable accounts (no longer returned by the broker) and ignored accounts —
  // there is nothing active to protect, so removal is safe immediately.
  const canRemoveImmediately =
    existing.missingFromBrokerSince != null ||
    existing.protectionStatus === "ignored" ||
    existing.protectionStatus === "archived";
  if (
    !canRemoveImmediately &&
    (existing.protectionStatus === "protected" || existing.protectionStatus === "monitor_only")
  ) {
    const userRules = await prisma.riskRules.findUnique({
      where: { userId: currentUser.id },
      select: { sessionStartHour: true, sessionEndHour: true, protectionLockCutoffMinutes: true },
    });
    const lock = getProtectionLockState({
      sessionStartHour: userRules?.sessionStartHour ?? null,
      sessionEndHour: userRules?.sessionEndHour ?? null,
      cutoffMinutes: userRules?.protectionLockCutoffMinutes ?? null,
    });
    if (lock.isLocked) {
      return NextResponse.json(
        {
          error: "protection_locked",
          message:
            "This account is protected during today's trading session. Disconnect is blocked until the session ends.",
        },
        { status: 409 },
      );
    }
  }

  const revokeAttempted = platformHasRevocationEndpoint(existing.platform);
  const revokeSucceeded = false;

  console.info("[accounts/disconnect] disconnecting broker account", {
    accountId: id,
    userId: currentUser.id,
    platform: existing.platform,
    revokeAttempted,
    revokeSucceeded,
  });

  const update = buildDisconnectUpdate();
  await prisma.connectedAccount.update({
    where: { id },
    data: update,
  });

  console.info("[accounts/disconnect] local disconnect succeeded", {
    accountId: id,
    platform: existing.platform,
  });

  if (!revokeAttempted) {
    void buildNoRevocationResult();
  }

  return NextResponse.json({ ok: true, revokeAttempted, revokeSucceeded });
}
