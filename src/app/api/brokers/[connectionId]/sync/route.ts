import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { syncTradovateConnection } from "@/lib/brokers/tradovate-sync";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { connectionId } = await params;

  const limit = checkRateLimit(`tradovate_sync_conn:${currentUser.id}`, 10, 3_600_000);
  if (!limit.ok) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
  }

  const connection = await prisma.brokerConnection.findFirst({
    where: { id: connectionId, userId: currentUser.id, platform: "tradovate" },
    select: { id: true },
  });
  if (!connection) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { results, discovery } = await syncTradovateConnection(
    connectionId,
    currentUser.id,
  );
  const allOk = results.every((r) => r.ok);

  return NextResponse.json({
    ok: allOk,
    results: results.map((r) => ({
      accountId: r.accountId,
      ok: r.ok,
      balance: r.balance,
      lastSyncAt: r.lastSyncAt,
      errorCode: r.errorCode,
    })),
    discovery: {
      ok: discovery.ok,
      newAccountsCount: discovery.newlyCreatedIds.length,
      missingCount: discovery.missingIds.length,
    },
  });
}
