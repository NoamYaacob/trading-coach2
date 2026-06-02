import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildManualLockoutPlan } from "./lockout-helpers";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const limit = checkRateLimit(`account_lockout:${user.id}`, 10, 3_600_000);
  if (!limit.ok) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
  }

  const { id } = await params;

  const account = await prisma.connectedAccount.findFirst({
    where: {
      id,
      userId: user.id,
      isActive: true,
      protectionStatus: { in: ["protected", "monitor_only"] },
    },
    select: { id: true, userId: true },
  });
  if (!account) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const plan = buildManualLockoutPlan({ accountId: id, userId: user.id });

  await prisma.$transaction([
    prisma.liveSessionState.upsert({
      where: { accountId: id },
      create: plan.liveSessionState.create,
      update: plan.liveSessionState.update,
    }),
    prisma.internalLockEvent.upsert({
      where: { activeDedupKey: plan.activeDedupKey },
      create: plan.internalLockEvent.create,
      update: plan.internalLockEvent.update,
    }),
  ]);

  console.info("[account-lockout] manual lock applied", {
    accountId: id,
    userId: user.id,
    tradingDay: plan.tradingDay,
  });

  return NextResponse.json({ ok: true, accountId: id, tradingDay: plan.tradingDay, status: "locked" });
}
