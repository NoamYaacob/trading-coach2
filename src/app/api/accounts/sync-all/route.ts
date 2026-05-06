import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { syncTradovateConnection } from "@/lib/brokers/tradovate-sync";
import { checkRateLimit } from "@/lib/rate-limit";
import { aggregateSyncAll, type SyncAllSyncResult } from "./aggregate";

/**
 * POST /api/accounts/sync-all
 *
 * Syncs every active Tradovate broker connection for the current user.
 * Connections are processed sequentially to avoid hammering Tradovate.
 *
 * Response shape:
 *   { ok, syncedConnections, failedConnections, syncedAccounts, failedAccounts }
 *
 * The button on the dashboard uses this single endpoint instead of issuing
 * one fetch per connection from the client — keeps the user-facing UX simple
 * (one button, one loading state, one result message).
 */
export async function POST(_request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 6 sync-all calls per hour matches the per-connection limit (10) loosely;
  // a user with multiple connections can still keep up via the per-connection
  // buttons if they hit this cap.
  const limit = checkRateLimit(`tradovate_sync_all:${currentUser.id}`, 6, 3_600_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "too_many_requests", retryAfterSeconds: limit.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const connections = await prisma.brokerConnection.findMany({
    where: {
      userId: currentUser.id,
      platform: "tradovate",
      connectionStatus: { in: ["connected_readonly", "connected_live"] },
    },
    select: { id: true },
  });

  const perConnection: SyncAllSyncResult[] = [];

  for (const conn of connections) {
    try {
      const { results: syncResults } = await syncTradovateConnection(
        conn.id,
        currentUser.id,
      );
      perConnection.push({ connectionId: conn.id, syncResults });
    } catch (err) {
      const code = err instanceof Error ? err.message : "UNKNOWN";
      console.error("[sync-all] connection sync failed", {
        connectionId: conn.id,
        error: code,
      });
      perConnection.push({ connectionId: conn.id, errorCode: code });
    }
  }

  return NextResponse.json(aggregateSyncAll(perConnection));
}
