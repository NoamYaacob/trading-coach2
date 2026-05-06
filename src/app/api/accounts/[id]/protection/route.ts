import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  canChangeProtection,
  getProtectionLockState,
  type ProtectionStatus,
} from "@/lib/account-protection";

const VALID_STATUSES: ProtectionStatus[] = [
  "protected",
  "monitor_only",
  "ignored",
  "archived",
  "pending_decision",
];

type Body = { protectionStatus?: string };

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const limit = checkRateLimit(`account_protection:${user.id}`, 60, 3_600_000);
  if (!limit.ok) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
  }

  const { id } = await params;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const newStatus = body.protectionStatus as ProtectionStatus | undefined;
  if (!newStatus || !VALID_STATUSES.includes(newStatus)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }
  // pending_decision can only be set by sync discovery, not by the user.
  if (newStatus === "pending_decision") {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }

  const account = await prisma.connectedAccount.findFirst({
    where: { id, userId: user.id },
    select: { id: true, protectionStatus: true },
  });
  if (!account) {
    console.warn("[account-protection] account not found", { accountId: id, userId: user.id });
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const currentStatus = account.protectionStatus as ProtectionStatus;

  console.info("[account-protection] status change requested", {
    accountId: account.id,
    userId: user.id,
    previousStatus: currentStatus,
    newStatus,
  });

  if (currentStatus === newStatus) {
    return NextResponse.json({ ok: true, applied: true, status: currentStatus });
  }

  // Archiving always applies immediately regardless of the protection lock.
  // The lock exists to prevent accidental protection downgrade on live accounts
  // during trading hours. Archiving is explicit cleanup for unavailable accounts
  // and is reversible (restore by changing status back to protected/monitor_only).
  if (newStatus === "archived") {
    await prisma.connectedAccount.update({
      where: { id: account.id },
      data: {
        protectionStatus: "archived",
        pendingProtectionStatus: null,
        pendingProtectionEffectiveDate: null,
      },
    });
    console.info("[account-protection] archived immediately", {
      accountId: account.id,
      userId: user.id,
      previousStatus: currentStatus,
    });
    return NextResponse.json({ ok: true, applied: true, status: "archived" });
  }

  // Compute lock state from the user's session config.
  const rules = await prisma.riskRules.findUnique({
    where: { userId: user.id },
    select: {
      sessionStartHour: true,
      sessionEndHour: true,
      protectionLockCutoffMinutes: true,
    },
  });
  const lock = getProtectionLockState({
    sessionStartHour: rules?.sessionStartHour ?? null,
    sessionEndHour: rules?.sessionEndHour ?? null,
    cutoffMinutes: rules?.protectionLockCutoffMinutes ?? null,
  });

  const decision = canChangeProtection(currentStatus, newStatus, lock);

  if (!decision.allowed) {
    // Save as pending — applies on the next trading day.
    await prisma.connectedAccount.update({
      where: { id: account.id },
      data: {
        pendingProtectionStatus: newStatus,
        pendingProtectionEffectiveDate: decision.appliesOnTradingDay,
      },
    });
    console.info("[account-protection] deferred (protection locked)", {
      accountId: account.id,
      userId: user.id,
      previousStatus: currentStatus,
      newStatus,
      appliesOnTradingDay: decision.appliesOnTradingDay,
    });
    return NextResponse.json({
      ok: true,
      applied: false,
      reason: "protection_locked",
      status: currentStatus,
      pendingStatus: newStatus,
      effectiveDate: decision.appliesOnTradingDay,
      message:
        "Protection is locked for today. Changes will apply from the next trading day.",
    });
  }

  // Apply immediately. Clear any earlier pending change since the user has
  // now actively chosen a status.
  await prisma.connectedAccount.update({
    where: { id: account.id },
    data: {
      protectionStatus: newStatus,
      pendingProtectionStatus: null,
      pendingProtectionEffectiveDate: null,
    },
  });
  console.info("[account-protection] applied immediately", {
    accountId: account.id,
    userId: user.id,
    previousStatus: currentStatus,
    newStatus,
  });

  return NextResponse.json({
    ok: true,
    applied: true,
    status: newStatus,
    appliesOnTradingDay: decision.appliesOnTradingDay,
  });
}
