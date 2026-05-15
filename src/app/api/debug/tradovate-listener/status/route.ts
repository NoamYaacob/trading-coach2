import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTradovateConfig } from "@/lib/brokers/tradovate-env";
import { TRADOVATE_WS_URL } from "@/lib/brokers/tradovate-websocket-protocol";
import {
  planListenerStartups,
  type BrokerConnectionRow,
} from "@/lib/brokers/tradovate-listener-worker-logic";

/**
 * GET /api/debug/tradovate-listener/status
 *
 * Returns a per-connection diagnostic snapshot for the current user's
 * Tradovate broker connections — enough to debug a stuck listener without
 * Railway log access.
 *
 * Includes:
 *   - connectionStatus / permissionLevel / token expiry
 *   - listener fields (status, last heartbeat / event / connected at)
 *   - retry tracking (lastAuthFailureAt, nextRetryAt, retryCount)
 *   - listenerEligibility from planListenerStartups (would the worker start it?)
 *   - endpoint chain (tokenUrlHost, restBaseHost, wsHost) with mismatch flag
 *   - last auth status and last WS close code/reason (when available)
 *
 * Security:
 *   - Requires authenticated session (401 otherwise).
 *   - In production requires `x-cron-secret` header matching CRON_SECRET env var.
 *   - Only returns rows owned by the current user.
 *   - Never reads, decrypts, or returns token fields.
 */
export async function GET(request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (process.env.NODE_ENV === "production") {
    const secret = request.headers.get("x-cron-secret");
    const expected = process.env.CRON_SECRET;
    if (!expected || secret !== expected) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const rows = await prisma.brokerConnection.findMany({
    where: { userId: currentUser.id, platform: "tradovate" },
    select: {
      id: true,
      userId: true,
      platform: true,
      env: true,
      brokerUserId: true,
      connectionStatus: true,
      permissionLevel: true,
      tokenExpiresAt: true,
      lastRenewError: true,
      lastRenewedAt: true,
      createdAt: true,
      listenerStatus: true,
      listenerConnectedAt: true,
      listenerLastEventAt: true,
      listenerLastHeartbeatAt: true,
      listenerErrorMessage: true,
      listenerLastAuthFailureAt: true,
      listenerNextRetryAt: true,
      listenerRetryCount: true,
      listenerDisabledAt: true,
      listenerLastCloseCode: true,
      listenerLastCloseReason: true,
      listenerLastAuthStatus: true,
      _count: { select: { accounts: true } },
    },
  });

  const enableLive = process.env.TRADOVATE_LISTENER_ENABLE_LIVE === "true";
  const listenerDisabled = process.env.TRADOVATE_LISTENER_DISABLED === "true";
  const singleConnectionId =
    process.env.TRADOVATE_LISTENER_CONNECTION_ID?.trim() || null;

  // Run the same planner the worker runs so the dashboard reflects the worker's
  // decision tree exactly (including retry cooldown and operator disable).
  const planRows: BrokerConnectionRow[] = rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    platform: r.platform,
    env: r.env,
    brokerUserId: r.brokerUserId,
    connectionStatus: r.connectionStatus,
    permissionLevel: r.permissionLevel,
    tokenExpiresAt: r.tokenExpiresAt,
    lastRenewError: r.lastRenewError,
    listenerStatus: r.listenerStatus,
    listenerNextRetryAt: r.listenerNextRetryAt,
    listenerDisabledAt: r.listenerDisabledAt,
  }));
  const plan = planListenerStartups(planRows, {
    enableLive,
    globallyDisabled: listenerDisabled,
    singleConnectionId,
  });
  const wouldStartIds = new Set(plan.start.map((p) => p.connectionId));
  const skipByConn = new Map(plan.skipped.map((s) => [s.connectionId, s]));

  const cfg = getTradovateConfig();
  const safeHost = (url: string): string => {
    try { return new URL(url).host; } catch { return url; }
  };

  const now = Date.now();
  const connections = rows.map((r) => {
    const env = r.env === "live" || r.env === "demo" ? r.env : null;
    const endpointChain =
      env && cfg.state === "ready"
        ? {
            tokenUrlHost: safeHost(cfg.config.tokenUrl[env]),
            restBaseHost: safeHost(cfg.config.apiBaseUrl[env]),
            wsHost: safeHost(TRADOVATE_WS_URL[env]),
            tokenAndRestSameHost:
              safeHost(cfg.config.tokenUrl[env]) ===
              safeHost(cfg.config.apiBaseUrl[env]),
          }
        : null;

    const tokenExpired =
      r.tokenExpiresAt !== null && r.tokenExpiresAt.getTime() < now;

    const skip = skipByConn.get(r.id);

    return {
      connectionId: r.id,
      env: r.env,
      connectionStatus: r.connectionStatus,
      permissionLevel: r.permissionLevel,
      hasBrokerUserId: r.brokerUserId !== null && r.brokerUserId.length > 0,
      accountCount: r._count.accounts,
      createdAt: r.createdAt.toISOString(),
      tokenExpiresAt: r.tokenExpiresAt?.toISOString() ?? null,
      tokenExpired,
      lastRenewError: r.lastRenewError,
      lastRenewedAt: r.lastRenewedAt?.toISOString() ?? null,
      listener: {
        status: r.listenerStatus,
        errorMessage: r.listenerErrorMessage,
        connectedAt: r.listenerConnectedAt?.toISOString() ?? null,
        lastEventAt: r.listenerLastEventAt?.toISOString() ?? null,
        lastHeartbeatAt: r.listenerLastHeartbeatAt?.toISOString() ?? null,
        lastAuthFailureAt: r.listenerLastAuthFailureAt?.toISOString() ?? null,
        nextRetryAt: r.listenerNextRetryAt?.toISOString() ?? null,
        retryCount: r.listenerRetryCount,
        disabledAt: r.listenerDisabledAt?.toISOString() ?? null,
        lastAuthStatus: r.listenerLastAuthStatus,
        lastCloseCode: r.listenerLastCloseCode,
        lastCloseReason: r.listenerLastCloseReason,
      },
      listenerEligibility: {
        wouldStart: wouldStartIds.has(r.id),
        skipReason: skip?.reason ?? null,
      },
      endpointChain,
    };
  });

  // ── Duplicate-connection groups ────────────────────────────────────────────
  // Group connections by env + brokerUserId. Connections sharing the same
  // (env, brokerUserId) pair are OAuth reconnects for the same physical
  // Tradovate account; old grants are stale/superseded. This view makes it
  // easy to identify which connection is the active one and which are leftovers.
  //
  // Connections with null brokerUserId cannot be definitively correlated and
  // are each shown in their own singleton group.
  type GroupEntry = {
    groupKey: string;
    env: string;
    brokerUserId: string | null;
    isDuplicate: boolean;
    connections: Array<{
      connectionId: string;
      createdAt: string;
      connectionStatus: string;
      accountCount: number;
      listenerStatus: string | null;
      lastHeartbeatAt: string | null;
      lastHeartbeatAgeSecs: number | null;
      lastRenewedAt: string | null;
      isActiveListener: boolean;
    }>;
  };

  const groupMap = new Map<string, { rows: typeof rows; brokerUserId: string | null; env: string }>();
  for (const r of rows) {
    const key =
      r.brokerUserId && r.brokerUserId.length > 0
        ? `${r.env}::${r.brokerUserId}`
        : `${r.env}::${r.id}`;
    if (!groupMap.has(key)) groupMap.set(key, { rows: [], brokerUserId: r.brokerUserId, env: r.env });
    groupMap.get(key)!.rows.push(r);
  }

  const connectionGroups: GroupEntry[] = [];
  for (const [groupKey, { rows: groupRows, brokerUserId, env }] of groupMap) {
    // The "active" listener is the one with the most recent heartbeat among
    // connections that have an active or recently-active listener status.
    const activeRow = groupRows.reduce<(typeof groupRows)[0] | null>((best, r) => {
      if (!r.listenerStatus || r.listenerStatus === "error") return best;
      if (!best) return r;
      const rSignal = r.listenerLastHeartbeatAt ?? r.listenerConnectedAt;
      const bSignal = best.listenerLastHeartbeatAt ?? best.listenerConnectedAt;
      if (!rSignal) return best;
      if (!bSignal) return r;
      return rSignal > bSignal ? r : best;
    }, null);

    connectionGroups.push({
      groupKey,
      env,
      brokerUserId: brokerUserId && brokerUserId.length > 0 ? brokerUserId : null,
      isDuplicate: groupRows.length > 1,
      connections: groupRows.map((r) => {
        const hb = r.listenerLastHeartbeatAt;
        return {
          connectionId: r.id,
          createdAt: r.createdAt.toISOString(),
          connectionStatus: r.connectionStatus,
          accountCount: r._count.accounts,
          listenerStatus: r.listenerStatus,
          lastHeartbeatAt: hb?.toISOString() ?? null,
          lastHeartbeatAgeSecs: hb ? Math.round((now - hb.getTime()) / 1000) : null,
          lastRenewedAt: r.lastRenewedAt?.toISOString() ?? null,
          isActiveListener: activeRow?.id === r.id,
        };
      }),
    });
  }

  // Sort: duplicates first (most actionable), then by env, then groupKey.
  connectionGroups.sort((a, b) => {
    if (a.isDuplicate !== b.isDuplicate) return a.isDuplicate ? -1 : 1;
    if (a.env !== b.env) return a.env.localeCompare(b.env);
    return a.groupKey.localeCompare(b.groupKey);
  });

  return NextResponse.json({
    ok: true,
    worker: {
      enableLive,
      listenerDisabled,
      singleConnectionId,
    },
    summary: {
      total: connections.length,
      wouldStart: plan.start.length,
      wouldSkip: plan.skipped.length,
      duplicateGroups: connectionGroups.filter((g) => g.isDuplicate).length,
    },
    connections,
    connectionGroups,
  });
}
