import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { syncTradovateAccount } from "@/lib/brokers/tradovate-sync";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const limit = checkRateLimit(`tradovate_sync_account:${currentUser.id}`, 20, 3_600_000);
  if (!limit.ok) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
  }

  const account = await prisma.connectedAccount.findFirst({
    where: { id, userId: currentUser.id, platform: "tradovate", isActive: true },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const result = await syncTradovateAccount(id, currentUser.id);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.errorCode, message: result.errorMessage },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    balance: result.balance,
    openPnl: result.openPnl,
    dailyPnl: result.dailyPnl,
    lastSyncAt: result.lastSyncAt,
  });
}
