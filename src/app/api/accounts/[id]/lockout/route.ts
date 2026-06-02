import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildInternalLockDedupKey } from "@/lib/guardian-engine/internal-lock-evaluator";
import { deriveCmeTradingDayKey } from "@/lib/trading-day";

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

  const tradingDay = deriveCmeTradingDayKey();
  const activeDedupKey = buildInternalLockDedupKey(id, "manual_lock", tradingDay);
  const now = new Date();

  await prisma.$transaction([
    prisma.liveSessionState.upsert({
      where: { accountId: id },
      create: { accountId: id, sessionDate: tradingDay, riskState: "STOPPED" },
      update: { riskState: "STOPPED" },
    }),
    prisma.internalLockEvent.upsert({
      where: { activeDedupKey },
      create: {
        accountId: id,
        userId: user.id,
        ruleType: "manual_lock",
        tradingDay,
        internalOnly: true,
        brokerActionTaken: false,
        activeDedupKey,
        updatedAt: now,
      },
      update: { updatedAt: now },
    }),
  ]);

  console.info("[account-lockout] manual lock applied", {
    accountId: id,
    userId: user.id,
    tradingDay,
  });

  return NextResponse.json({ ok: true, accountId: id, tradingDay, status: "locked" });
}
