/**
 * POST /api/broker-connections/:id/disconnect
 *
 * Safely disconnects an entire broker connection:
 *   1. Evaluates each linked account for rule-breach / session-lock status.
 *   2. Clean accounts → archived immediately (protectionStatus = "archived").
 *   3. Locked accounts → scheduled via pendingProtectionStatus / effectiveDate
 *      (same mechanism as the pending-rule-promoter cron).
 *   4. If all accounts are now archived: deletes the BrokerConnection row.
 *   5. If any accounts are scheduled: leaves the connection intact until the
 *      cron promotes the pending archives (next trading day).
 *
 * Historical data (NormalizedTradeEvent, AccountRiskRules, InternalLockEvent,
 * GuardianStatus, BrokerOrderActionLog, RuleChangeAudit) is NEVER deleted.
 *
 * Returns a structured result:
 *   {
 *     ok: true,
 *     status: "removed_now" | "scheduled" | "partial",
 *     connectionDeleted: boolean,
 *     effectiveAt: string | null,   // YYYY-MM-DD of scheduled removal
 *     affectedAccounts: Array<{
 *       id: string, label: string,
 *       status: "archived_now" | "scheduled",
 *       scheduledFor?: string, lockReason?: string,
 *     }>,
 *   }
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkAccountRemovalEligibility } from "@/lib/account-removal-guard";
import { checkRateLimit } from "@/lib/rate-limit";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const limit = checkRateLimit(`broker_conn_disconnect:${currentUser.id}`, 10, 3_600_000);
  if (!limit.ok) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
  }

  const { id } = await ctx.params;

  const bc = await prisma.brokerConnection.findFirst({
    where: { id, userId: currentUser.id },
    select: { id: true, platform: true, env: true },
  });
  if (!bc) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Load all non-archived linked accounts.
  const linkedAccounts = await prisma.connectedAccount.findMany({
    where: {
      brokerConnectionId: id,
      userId: currentUser.id,
      isActive: true,
      protectionStatus: { not: "archived" },
    },
    select: { id: true, label: true },
  });

  const now = new Date();
  type AccountResult = {
    id: string;
    label: string;
    status: "archived_now" | "scheduled";
    scheduledFor?: string;
    lockReason?: string;
  };
  const results: AccountResult[] = [];

  for (const acct of linkedAccounts) {
    const eligibility = await checkAccountRemovalEligibility(acct.id, currentUser.id, now);

    if (eligibility.canRemoveNow) {
      await prisma.connectedAccount.update({
        where: { id: acct.id },
        data: {
          protectionStatus: "archived",
          pendingProtectionStatus: null,
          pendingProtectionEffectiveDate: null,
        },
      });
      results.push({ id: acct.id, label: acct.label, status: "archived_now" });
    } else {
      await prisma.connectedAccount.update({
        where: { id: acct.id },
        data: {
          pendingProtectionStatus: "archived",
          pendingProtectionEffectiveDate: eligibility.nextTradingDay,
        },
      });
      results.push({
        id: acct.id,
        label: acct.label,
        status: "scheduled",
        scheduledFor: eligibility.nextTradingDay,
        lockReason: eligibility.lockReason ?? undefined,
      });
    }
  }

  // Attempt to delete the connection if no active non-archived accounts remain.
  const remainingActive = await prisma.connectedAccount.count({
    where: {
      brokerConnectionId: id,
      isActive: true,
      protectionStatus: { not: "archived" },
    },
  });

  let connectionDeleted = false;
  if (remainingActive === 0) {
    await prisma.brokerConnection.delete({ where: { id } });
    connectionDeleted = true;
    console.info("[broker-connections/disconnect] connection deleted after all accounts archived", {
      brokerConnectionId: id,
      userId: currentUser.id,
    });
  } else {
    console.info("[broker-connections/disconnect] connection kept — accounts pending archival", {
      brokerConnectionId: id,
      userId: currentUser.id,
      remainingActive,
    });
  }

  const hasScheduled = results.some((r) => r.status === "scheduled");
  const hasImmediate = results.some((r) => r.status === "archived_now");
  const status =
    results.length === 0
      ? "removed_now"
      : hasScheduled && hasImmediate
        ? "partial"
        : hasScheduled
          ? "scheduled"
          : "removed_now";

  const scheduledFor = results.find((r) => r.status === "scheduled")?.scheduledFor ?? null;

  console.info("[broker-connections/disconnect] disconnect complete", {
    brokerConnectionId: id,
    userId: currentUser.id,
    status,
    connectionDeleted,
    immediateCount: results.filter((r) => r.status === "archived_now").length,
    scheduledCount: results.filter((r) => r.status === "scheduled").length,
  });

  return NextResponse.json({
    ok: true,
    status,
    connectionDeleted,
    effectiveAt: scheduledFor,
    affectedAccounts: results,
  });
}
