import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import { syncTradovateConnection } from "@/lib/brokers/tradovate-sync";
import { needsSync, CRON_SYNC_FRESHNESS_MS } from "@/lib/sync-freshness";
import { runPermissionProbe } from "@/lib/brokers/permission-probe-runner";

// Re-probe broker permissions at most once every 24h per connection.
const PROBE_REFRESH_MS = 24 * 60 * 60 * 1000;

/**
 * POST /api/cron/tradovate-sync
 *
 * Syncs all active Tradovate broker connections whose accounts are stale.
 * Intended to be called by a Railway/Vercel cron schedule every 2–5 minutes
 * during trading hours.
 *
 * Protection: requires x-cron-secret header matching CRON_SECRET env var.
 * Only syncs accounts with protectionStatus protected or monitor_only
 * (enforced inside syncTradovateConnection).
 *
 * Configure in railway.toml / vercel.json:
 *   POST /api/cron/tradovate-sync  every 5 minutes
 * Set CRON_SECRET to a long random string and add it to your scheduler config.
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Find all active Tradovate connections that have at least one protected/
  // monitor_only account which needs a fresh sync.
  const connections = await prisma.brokerConnection.findMany({
    where: {
      platform: "tradovate",
      connectionStatus: { in: ["connected_readonly", "connected_live"] },
      accounts: {
        some: {
          isActive: true,
          platform: "tradovate",
          protectionStatus: { in: ["protected", "monitor_only"] },
        },
      },
    },
    select: {
      id: true,
      userId: true,
      permissionsProbedAt: true,
      accounts: {
        where: {
          isActive: true,
          platform: "tradovate",
          protectionStatus: { in: ["protected", "monitor_only"] },
        },
        select: { id: true, lastSyncAt: true },
      },
    },
  });

  // Filter to connections where at least one account is stale.
  const staleConnections = connections.filter((bc) =>
    bc.accounts.some((a) => needsSync(a.lastSyncAt, CRON_SYNC_FRESHNESS_MS)),
  );

  console.info("[cron/tradovate-sync] connections to sync", {
    total: connections.length,
    stale: staleConnections.length,
  });

  if (staleConnections.length === 0) {
    return NextResponse.json({ ok: true, synced: 0, skipped: connections.length });
  }

  const results: Array<{
    connectionId: string;
    ok: boolean;
    accountCount: number;
    errorCode?: string | null;
  }> = [];

  // Process connections sequentially to avoid overwhelming Tradovate's API.
  for (const bc of staleConnections) {
    try {
      const { results: syncResults } = await syncTradovateConnection(bc.id, bc.userId);
      results.push({
        connectionId: bc.id,
        ok: syncResults.every((r) => r.ok),
        accountCount: syncResults.length,
      });

      // Refresh the permission probe at most once per 24h per connection.
      // The probe is best-effort — it must not affect sync results.
      const probeStale =
        bc.permissionsProbedAt == null ||
        Date.now() - bc.permissionsProbedAt.getTime() > PROBE_REFRESH_MS;
      if (probeStale && bc.accounts.length > 0) {
        await runPermissionProbe({
          brokerConnectionId: bc.id,
          accountId: bc.accounts[0].id,
          userId: bc.userId,
          source: "cron",
        });
      }
    } catch (err) {
      const code = err instanceof Error ? err.message : "UNKNOWN";
      console.error("[cron/tradovate-sync] connection sync failed", {
        connectionId: bc.id,
        error: code,
      });
      results.push({ connectionId: bc.id, ok: false, accountCount: 0, errorCode: code });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;

  console.info("[cron/tradovate-sync] done", {
    synced: succeeded,
    failed,
    skipped: connections.length - staleConnections.length,
  });

  return NextResponse.json({
    ok: failed === 0,
    synced: succeeded,
    failed,
    skipped: connections.length - staleConnections.length,
  });
}
