import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { shouldRenewToken, REFRESH_BUFFER_MS } from "@/lib/brokers/tradovate-client-helpers";
import { resolveEffectiveConnectionStatus } from "@/app/dashboard/_components/command-center/data-helpers";

/**
 * GET /api/debug/tradovate-tokens
 *
 * Returns token lifecycle state for all of the authenticated user's Tradovate
 * broker connections. Use this to diagnose whether "Reconnect" will show on
 * the Dashboard and whether proactive renewal will fire on the next sync.
 *
 * Fields per connection:
 *   tokenExpiresAt       — when the stored access token expires
 *   minutesUntilExpiry   — null when no expiry is stored
 *   lastRenewedAt        — when the access token was last successfully renewed
 *   minutesSinceRenewal  — null when never renewed
 *   lastRenewError       — error text from the most recent failed renewal attempt
 *   canRenew             — whether a refresh token is stored
 *   renewalDecision      — what shouldRenewToken returns right now
 *   connectionStatus     — BrokerConnection.connectionStatus (authority)
 *   permissionLevel      — BrokerConnection.permissionLevel from the last probe
 *   dashboardReconnectShown — whether the Dashboard orange banner fires
 *   finalUiStatus        — "reconnect_required" | "connected_live" | "connected_readonly" | ...
 */
export async function GET(_request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const brokerConnections = await prisma.brokerConnection.findMany({
    where: { userId: currentUser.id, platform: "tradovate" },
    select: {
      id: true,
      env: true,
      brokerUserId: true,
      connectionStatus: true,
      permissionLevel: true,
      permissionsProbedAt: true,
      tokenExpiresAt: true,
      lastRenewedAt: true,
      lastRenewError: true,
      refreshTokenEncrypted: true,
      listenerStatus: true,
      listenerConnectedAt: true,
      listenerLastEventAt: true,
      listenerLastHeartbeatAt: true,
      listenerErrorMessage: true,
      createdAt: true,
      accounts: {
        select: {
          id: true,
          label: true,
          connectionStatus: true,
          missingFromBrokerSince: true,
          isActive: true,
          protectionStatus: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const now = new Date();

  // Collect healthy envs for Reconnect banner simulation (mirrors filterExpiredGroups).
  const HEALTHY = new Set([
    "connected_live",
    "connected_readonly",
    "pending_webhook",
    "oauth_pending_storage",
  ]);
  const healthyEnvs = new Set<string | null>();
  for (const bc of brokerConnections) {
    if (HEALTHY.has(bc.connectionStatus)) healthyEnvs.add(bc.env);
  }

  const connections = brokerConnections.map((bc) => {
    const minutesUntilExpiry =
      bc.tokenExpiresAt != null
        ? Math.round((bc.tokenExpiresAt.getTime() - now.getTime()) / 60_000)
        : null;

    const minutesSinceRenewal =
      bc.lastRenewedAt != null
        ? Math.round((now.getTime() - bc.lastRenewedAt.getTime()) / 60_000)
        : null;

    const renewalDecision = shouldRenewToken({
      expiresAt: bc.tokenExpiresAt,
      now,
      bufferMs: REFRESH_BUFFER_MS,
    });

    const canRenew = bc.refreshTokenEncrypted != null;

    // Banner fires when: expired/error status AND recoverable account AND no healthy same-env BC.
    const isExpiredOrError =
      bc.connectionStatus === "expired" || bc.connectionStatus === "connection_error";
    const hasRecoverableAccount = bc.accounts.some(
      (a) => a.missingFromBrokerSince === null && a.connectionStatus !== "unavailable",
    );
    const healthyEnvCoversThisGroup = healthyEnvs.has(bc.env);
    const dashboardReconnectShown =
      isExpiredOrError && hasRecoverableAccount && !healthyEnvCoversThisGroup;

    // Derive the final UI status visible on the Dashboard (uses BC as authority).
    const representativeAccount =
      bc.accounts.find(
        (a) =>
          a.isActive &&
          (a.protectionStatus === "protected" || a.protectionStatus === "monitor_only"),
      ) ?? bc.accounts[0] ?? null;
    const effectiveStatus = representativeAccount
      ? resolveEffectiveConnectionStatus(representativeAccount.connectionStatus, bc.connectionStatus)
      : bc.connectionStatus;
    const finalUiStatus = effectiveStatus;

    const secondsSinceListenerHeartbeat =
      bc.listenerLastHeartbeatAt != null
        ? Math.round((now.getTime() - bc.listenerLastHeartbeatAt.getTime()) / 1_000)
        : null;

    const secondsSinceListenerEvent =
      bc.listenerLastEventAt != null
        ? Math.round((now.getTime() - bc.listenerLastEventAt.getTime()) / 1_000)
        : null;

    return {
      brokerConnectionId: bc.id,
      env: bc.env,
      brokerUserId: bc.brokerUserId ?? null,
      connectionStatus: bc.connectionStatus,
      permissionLevel: bc.permissionLevel,
      permissionsProbedAt: bc.permissionsProbedAt?.toISOString() ?? null,
      // Token expiry
      tokenExpiresAt: bc.tokenExpiresAt?.toISOString() ?? null,
      minutesUntilExpiry,
      tokenIsExpired: minutesUntilExpiry !== null && minutesUntilExpiry <= 0,
      // Renewal state.
      // renewErrorIsStale=true means the error survived a subsequent successful
      // reconnect and no longer reflects the current token state — the connection
      // is healthy and the error is purely historical.
      lastRenewedAt: bc.lastRenewedAt?.toISOString() ?? null,
      minutesSinceRenewal,
      lastRenewError: bc.lastRenewError ?? null,
      renewErrorIsStale:
        bc.lastRenewError !== null &&
        (bc.connectionStatus === "connected_readonly" ||
          bc.connectionStatus === "connected_live"),
      activeRenewError:
        bc.lastRenewError !== null &&
        (bc.connectionStatus === "expired" || bc.connectionStatus === "connection_error")
          ? bc.lastRenewError
          : null,
      canRenew,
      renewalDecision: {
        shouldRenew: renewalDecision.shouldRenew,
        reason: renewalDecision.reason,
        msUntilExpiry: renewalDecision.msUntilExpiry,
      },
      // Listener worker
      listenerStatus: bc.listenerStatus ?? null,
      listenerConnectedAt: bc.listenerConnectedAt?.toISOString() ?? null,
      listenerLastEventAt: bc.listenerLastEventAt?.toISOString() ?? null,
      listenerLastHeartbeatAt: bc.listenerLastHeartbeatAt?.toISOString() ?? null,
      listenerErrorMessage: bc.listenerErrorMessage ?? null,
      secondsSinceListenerHeartbeat,
      secondsSinceListenerEvent,
      // Dashboard impact
      dashboardReconnectShown,
      healthyEnvCoversThisGroup,
      finalUiStatus,
      accountCount: bc.accounts.length,
    };
  });

  const LISTENER_STALE_S = 120; // heartbeat overdue threshold in seconds

  const now2 = new Date();
  return NextResponse.json({
    userId: currentUser.id,
    now: now2.toISOString(),
    connections,
    summary: {
      total: connections.length,
      reconnectShown: connections.filter((c) => c.dashboardReconnectShown).length,
      willRenewOnNextSync: connections.filter((c) => c.renewalDecision.shouldRenew).length,
      expired: connections.filter((c) => c.connectionStatus === "expired").length,
      withActiveRenewError: connections.filter((c) => c.activeRenewError !== null).length,
      withStaleRenewError: connections.filter((c) => c.renewErrorIsStale).length,
      listenerConnected: connections.filter((c) => c.listenerStatus === "connected").length,
      listenerReconnecting: connections.filter(
        (c) => c.listenerStatus === "reconnecting" || c.listenerStatus === "connecting",
      ).length,
      listenerStale: connections.filter(
        (c) =>
          c.listenerStatus === "connected" &&
          (c.secondsSinceListenerHeartbeat === null ||
            c.secondsSinceListenerHeartbeat > LISTENER_STALE_S),
      ).length,
      listenerMissingHeartbeat: connections.filter(
        (c) => c.listenerStatus === "connected" && c.listenerLastHeartbeatAt === null,
      ).length,
    },
  });
}
