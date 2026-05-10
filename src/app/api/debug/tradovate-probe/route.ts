import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/debug/tradovate-probe
 *
 * Returns the current permission-probe state for all of the authenticated
 * user's Tradovate broker connections and their linked accounts.
 *
 * Use this to diagnose why a connection shows READ-ONLY after reconnect:
 *   - BrokerConnection.permissionLevel — the probe result ("full_access" |
 *     "read_only" | "unknown" | null)
 *   - BrokerConnection.permissionsProbedAt — when the probe last ran
 *   - BrokerConnection.connectionStatus — OAuth connection state
 *   - ConnectedAccount.connectionStatus — account-level state (transitions
 *     connected_readonly → connected_live only on first webhook event)
 *
 * Authentication: requires a valid session. Returns data for the current user
 * only — no connectionId param needed or accepted.
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
      connectionStatus: true,
      permissionLevel: true,
      permissionsProbedAt: true,
      createdAt: true,
      accounts: {
        select: {
          id: true,
          label: true,
          platform: true,
          connectionStatus: true,
          externalAccountId: true,
          isActive: true,
          connectedAt: true,
          lastSyncAt: true,
          brokerConnectionId: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Also show orphaned accounts (no brokerConnectionId).
  const orphanedAccounts = await prisma.connectedAccount.findMany({
    where: {
      userId: currentUser.id,
      platform: "tradovate",
      brokerConnectionId: null,
    },
    select: {
      id: true,
      label: true,
      platform: true,
      connectionStatus: true,
      externalAccountId: true,
      isActive: true,
      connectedAt: true,
      lastSyncAt: true,
      brokerConnectionId: true,
    },
  });

  const now = new Date();

  const connections = brokerConnections.map((bc) => ({
    brokerConnectionId: bc.id,
    env: bc.env,
    connectionStatus: bc.connectionStatus,
    permissionLevel: bc.permissionLevel,
    permissionsProbedAt: bc.permissionsProbedAt?.toISOString() ?? null,
    probeAgeMinutes:
      bc.permissionsProbedAt != null
        ? Math.round((now.getTime() - bc.permissionsProbedAt.getTime()) / 60_000)
        : null,
    createdAt: bc.createdAt.toISOString(),
    accounts: bc.accounts.map((a) => ({
      accountId: a.id,
      label: a.label,
      platform: a.platform,
      connectionStatus: a.connectionStatus,
      // Only log whether externalAccountId is set and what it is — it's a numeric
      // Tradovate account ID, not a secret. Required for the permission probe to work.
      externalAccountId: a.externalAccountId,
      hasExternalAccountId: Boolean(a.externalAccountId),
      isActive: a.isActive,
      connectedAt: a.connectedAt?.toISOString() ?? null,
      lastSyncAt: a.lastSyncAt?.toISOString() ?? null,
      brokerConnectionId: a.brokerConnectionId,
    })),
  }));

  return NextResponse.json({
    userId: currentUser.id,
    now: now.toISOString(),
    connections,
    orphanedAccounts: orphanedAccounts.map((a) => ({
      accountId: a.id,
      label: a.label,
      platform: a.platform,
      connectionStatus: a.connectionStatus,
      externalAccountId: a.externalAccountId,
      hasExternalAccountId: Boolean(a.externalAccountId),
      isActive: a.isActive,
      connectedAt: a.connectedAt?.toISOString() ?? null,
      lastSyncAt: a.lastSyncAt?.toISOString() ?? null,
      brokerConnectionId: a.brokerConnectionId,
    })),
    diagnosis: {
      // Quick-scan for the most common reason for READ-ONLY showing after a
      // successful reconnect.
      issues: connections.flatMap((bc) => {
        const issues: string[] = [];
        if (bc.permissionLevel === null) {
          issues.push(`BC ${bc.brokerConnectionId} (${bc.env}): permissionLevel is null — probe has never run`);
        }
        if (bc.permissionLevel === "unknown") {
          issues.push(`BC ${bc.brokerConnectionId} (${bc.env}): permissionLevel is "unknown" — probe ran but failed (check server logs for errorCode)`);
        }
        for (const a of bc.accounts) {
          if (!a.hasExternalAccountId) {
            issues.push(`Account ${a.accountId} (${a.label}): externalAccountId is null — probe will fail with NO_ACCOUNT_ID`);
          }
          if (a.connectionStatus === "connected_readonly" && bc.permissionLevel === "full_access") {
            issues.push(`Account ${a.accountId} (${a.label}): connectionStatus is connected_readonly but permissionLevel is full_access — UI was showing READ-ONLY incorrectly; now fixed to show Connected when full_access`);
          }
        }
        return issues;
      }),
    },
  });
}
