import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveEffectiveConnectionStatus } from "@/app/dashboard/_components/command-center/data-helpers";
import { deriveConnectionStatusLabel } from "@/app/dashboard/_components/command-center/data-helpers";

/**
 * GET /api/debug/tradovate-probe
 *
 * Returns the current permission-probe state for all of the authenticated
 * user's Tradovate broker connections and their linked accounts, plus a
 * simulation of what the Dashboard would display for each group.
 *
 * Use this to diagnose why a connection shows READ-ONLY or EXPIRED after reconnect:
 *   - BrokerConnection.connectionStatus — the OAuth connection state (authority)
 *   - BrokerConnection.permissionLevel  — the probe result
 *   - ConnectedAccount.connectionStatus — account-level cached state (may lag)
 *   - effectiveConnectionStatus         — what the Dashboard actually uses
 *   - displayedGroupStatus              — the label rendered in the group header
 *   - expiredBannerShown                — whether the orange reconnect banner fires
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
          missingFromBrokerSince: true,
          externalAccountId: true,
          isActive: true,
          connectedAt: true,
          lastSyncAt: true,
          brokerConnectionId: true,
          propFirm: true,
          accountType: true,
          protectionStatus: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Orphaned accounts (no brokerConnectionId).
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
      missingFromBrokerSince: true,
      externalAccountId: true,
      isActive: true,
      connectedAt: true,
      lastSyncAt: true,
      brokerConnectionId: true,
    },
  });

  const now = new Date();

  // Collect healthy envs for banner-suppression simulation (mirrors filterExpiredGroups).
  const HEALTHY = new Set([
    "connected_live",
    "connected_readonly",
    "pending_webhook",
    "oauth_pending_storage",
  ]);
  const healthyEnvs = new Set<string | null>();
  for (const bc of brokerConnections) {
    if (HEALTHY.has(bc.connectionStatus)) {
      healthyEnvs.add(bc.env);
    }
  }

  const connections = brokerConnections.map((bc) => {
    // Simulate Dashboard group: first account drives the group header.
    const dashboardAccounts = bc.accounts.filter(
      (a) => a.isActive && (a.protectionStatus === "protected" || a.protectionStatus === "monitor_only"),
    );
    const representativeAccount = dashboardAccounts[0] ?? bc.accounts[0] ?? null;

    const groupConnectionStatus = representativeAccount
      ? resolveEffectiveConnectionStatus(representativeAccount.connectionStatus, bc.connectionStatus)
      : bc.connectionStatus;

    const displayedGroupStatus = deriveConnectionStatusLabel(groupConnectionStatus);

    // Simulate whether the expired-connection orange banner would fire for this group.
    const isExpiredOrError =
      bc.connectionStatus === "expired" || bc.connectionStatus === "connection_error";
    const hasRecoverableAccount = bc.accounts.some(
      (a) => a.missingFromBrokerSince === null && a.connectionStatus !== "expired" ||
             (a.missingFromBrokerSince === null && a.connectionStatus === "expired"),
    );
    const hasRecoverableAccountStrict = bc.accounts.some(
      (a) => a.missingFromBrokerSince === null && a.connectionStatus !== "unavailable",
    );
    const healthyEnvCoversThisGroup = healthyEnvs.has(bc.env);

    // Banner fires only when: (a) expired/error AND (b) recoverable account exists
    // AND (c) no healthy BC covers this env — mirrors filterExpiredGroups.
    const expiredBannerShown =
      isExpiredOrError && hasRecoverableAccountStrict && !healthyEnvCoversThisGroup;

    return {
      brokerConnectionId: bc.id,
      env: bc.env,
      bcConnectionStatus: bc.connectionStatus,
      permissionLevel: bc.permissionLevel,
      permissionsProbedAt: bc.permissionsProbedAt?.toISOString() ?? null,
      probeAgeMinutes:
        bc.permissionsProbedAt != null
          ? Math.round((now.getTime() - bc.permissionsProbedAt.getTime()) / 60_000)
          : null,
      createdAt: bc.createdAt.toISOString(),
      // Dashboard simulation
      groupConnectionStatus,
      displayedGroupStatus,
      expiredBannerShown,
      healthyEnvCoversThisGroup,
      accounts: bc.accounts.map((a) => {
        const effective = resolveEffectiveConnectionStatus(a.connectionStatus, bc.connectionStatus);
        return {
          accountId: a.id,
          label: a.label,
          propFirm: a.propFirm,
          accountType: a.accountType,
          protectionStatus: a.protectionStatus,
          accountConnectionStatus: a.connectionStatus,
          effectiveConnectionStatus: effective,
          connectionStatusMismatch: effective !== a.connectionStatus,
          missingFromBrokerSince: a.missingFromBrokerSince?.toISOString() ?? null,
          externalAccountId: a.externalAccountId,
          hasExternalAccountId: Boolean(a.externalAccountId),
          isActive: a.isActive,
          connectedAt: a.connectedAt?.toISOString() ?? null,
          lastSyncAt: a.lastSyncAt?.toISOString() ?? null,
        };
      }),
    };
  });

  return NextResponse.json({
    userId: currentUser.id,
    now: now.toISOString(),
    connections,
    orphanedAccounts: orphanedAccounts.map((a) => ({
      accountId: a.id,
      label: a.label,
      platform: a.platform,
      connectionStatus: a.connectionStatus,
      missingFromBrokerSince: a.missingFromBrokerSince?.toISOString() ?? null,
      externalAccountId: a.externalAccountId,
      hasExternalAccountId: Boolean(a.externalAccountId),
      isActive: a.isActive,
      connectedAt: a.connectedAt?.toISOString() ?? null,
      lastSyncAt: a.lastSyncAt?.toISOString() ?? null,
      brokerConnectionId: a.brokerConnectionId,
    })),
    diagnosis: {
      issues: connections.flatMap((bc) => {
        const issues: string[] = [];
        if (bc.permissionLevel === null) {
          issues.push(`BC ${bc.brokerConnectionId} (${bc.env}): permissionLevel is null — probe has never run`);
        }
        if (bc.permissionLevel === "unknown") {
          issues.push(`BC ${bc.brokerConnectionId} (${bc.env}): permissionLevel is "unknown" — probe ran but failed (check server logs for errorCode)`);
        }
        if (bc.expiredBannerShown) {
          issues.push(`BC ${bc.brokerConnectionId} (${bc.env}): expired-reconnect banner IS showing on Dashboard`);
        }
        for (const a of bc.accounts) {
          if (!a.hasExternalAccountId) {
            issues.push(`Account ${a.accountId} (${a.label}): externalAccountId is null — probe will fail with NO_ACCOUNT_ID`);
          }
          if (a.connectionStatusMismatch) {
            issues.push(
              `Account ${a.accountId} (${a.label}): ` +
              `accountConnectionStatus="${a.accountConnectionStatus}" ` +
              `differs from bcConnectionStatus="${bc.bcConnectionStatus}" — ` +
              `Dashboard uses effectiveConnectionStatus="${a.effectiveConnectionStatus}"`,
            );
          }
        }
        return issues;
      }),
    },
  });
}
