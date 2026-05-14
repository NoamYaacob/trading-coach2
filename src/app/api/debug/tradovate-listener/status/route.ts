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
    },
    connections,
  });
}
