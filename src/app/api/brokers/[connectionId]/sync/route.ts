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
    select: { id: true, connectionStatus: true },
  });
  if (!connection) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Reject sync attempts on expired/errored connections before reaching the
  // sync function, which would throw and bubble up as a confusing 502.
  if (
    connection.connectionStatus === "expired" ||
    connection.connectionStatus === "connection_error"
  ) {
    return NextResponse.json(
      { ok: false, error: "reconnect_required", connectionStatus: connection.connectionStatus },
      { status: 409 },
    );
  }

  let syncResult: Awaited<ReturnType<typeof syncTradovateConnection>>;
  try {
    syncResult = await syncTradovateConnection(connectionId, currentUser.id);
  } catch (err) {
    const code = err instanceof Error ? err.message : "SYNC_FAILED";
    console.error("[brokers/sync] syncTradovateConnection threw", {
      connectionId,
      error: code,
    });
    return NextResponse.json({ ok: false, error: code }, { status: 502 });
  }

  const { results, discovery } = syncResult;
  const allOk = results.every((r) => r.ok);

  return NextResponse.json({
    ok: allOk,
    results: results.map((r) => ({
      accountId: r.accountId,
      ok: r.ok,
      balance: r.balance,
      lastSyncAt: r.lastSyncAt,
      errorCode: r.errorCode,
      maxPositionSize: r.maxPositionSize,
    })),
    discovery: {
      ok: discovery.ok,
      newAccountsCount: discovery.newlyCreatedIds.length,
      missingCount: discovery.missingIds.length,
    },
  });
}
