/**
 * POST /api/debug/broker-sync-summary
 *
 * Admin-only. Runs a full Tradovate account-list probe + reconciliation for
 * every active BrokerConnection owned by the current user, then returns a
 * safe summary.
 *
 * Safe-output contract:
 *   - No accessTokenEncrypted / refreshTokenEncrypted in response.
 *   - No raw token values anywhere.
 *   - bodyPreview (from Tradovate API errors) is included only when the call failed.
 *
 * Destructive: this calls runDiscoveryForConnection, which DOES write to the
 * DB (stamps lastSeenInBrokerAt, sets missingFromBrokerSince, creates
 * pending_decision rows). This mirrors exactly what "Sync all" does.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { isAdminEmail } from "@/lib/subscription";
import { prisma } from "@/lib/db";
import {
  fetchTradovateAccountListWithDiagnostics,
  runDiscoveryForConnection,
} from "@/lib/brokers/tradovate-discovery";
import { getTradovateConfig } from "@/lib/brokers/tradovate-env";
import { parseAndDecrypt } from "@/lib/security/token-crypto";

export async function POST(_request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isAdminEmail(currentUser.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const cfg = getTradovateConfig();
  const configReady = cfg.state === "ready";

  // Load all Tradovate BrokerConnections for this user (no token fields in result).
  const connections = await prisma.brokerConnection.findMany({
    where: { userId: currentUser.id, platform: "tradovate" },
    select: {
      id: true,
      env: true,
      connectionStatus: true,
      brokerUserId: true,
      tokenExpiresAt: true,
      permissionLevel: true,
      accessTokenEncrypted: true, // only used in-process; never returned
    },
    orderBy: { createdAt: "desc" },
  });

  // Snapshot before-state: count pending_decision and missing accounts.
  const beforeAccounts = await prisma.connectedAccount.findMany({
    where: { userId: currentUser.id, platform: "tradovate" },
    select: {
      id: true,
      label: true,
      externalAccountId: true,
      protectionStatus: true,
      missingFromBrokerSince: true,
      brokerConnectionId: true,
    },
  });
  const beforePendingCount = beforeAccounts.filter((a) => a.protectionStatus === "pending_decision").length;
  const beforeMissingCount = beforeAccounts.filter((a) => a.missingFromBrokerSince != null).length;

  const perConnection: Array<{
    connectionId: string;
    env: string;
    connectionStatus: string;
    brokerUserId: string | null;
    tokenExpiresAt: string | null;
    isActive: boolean;
    probe: {
      attempted: boolean;
      httpStatus: number | null;
      accountsReturned: number | null;
      accounts: Array<{ externalAccountId: string; name: string; accountType: string; active: boolean }> | null;
      bodyPreview: string | null;
      errorMessage: string | null;
    };
    discovery: {
      attempted: boolean;
      ok: boolean | null;
      newlyCreatedCount: number;
      newlyCreatedIds: string[];
      missingCount: number;
      missingIds: string[];
      errorMessage: string | null;
    };
  }> = [];

  for (const conn of connections) {
    const isActive =
      conn.connectionStatus === "connected_readonly" ||
      conn.connectionStatus === "connected_live";

    let probe: (typeof perConnection)[0]["probe"] = {
      attempted: false,
      httpStatus: null,
      accountsReturned: null,
      accounts: null,
      bodyPreview: null,
      errorMessage: configReady ? null : "Tradovate config not ready — check TRADOVATE_* env vars",
    };

    let discovery: (typeof perConnection)[0]["discovery"] = {
      attempted: false,
      ok: null,
      newlyCreatedCount: 0,
      newlyCreatedIds: [],
      missingCount: 0,
      missingIds: [],
      errorMessage: null,
    };

    if (isActive && configReady) {
      // Phase 1: probe /account/list (safe, just an HTTP GET).
      try {
        const accessToken = parseAndDecrypt(conn.accessTokenEncrypted);
        const env = conn.env as "live" | "demo";
        const result = await fetchTradovateAccountListWithDiagnostics(
          cfg.config.apiBaseUrl[env],
          accessToken,
        );
        probe = {
          attempted: true,
          httpStatus: result.httpStatus,
          accountsReturned: result.accounts?.length ?? null,
          accounts: result.accounts?.map((a) => ({
            externalAccountId: a.externalAccountId,
            name: a.name,
            accountType: a.accountType,
            active: a.active,
          })) ?? null,
          bodyPreview: result.errorMessage ? result.bodyPreview : null,
          errorMessage: result.errorMessage,
        };
      } catch (err) {
        probe = {
          ...probe,
          attempted: true,
          errorMessage: `Token decrypt failed: ${err instanceof Error ? err.message : "unknown"}`,
        };
      }

      // Phase 2: run reconciliation (writes to DB — matches "Sync all" behaviour).
      try {
        const result = await runDiscoveryForConnection(conn.id, currentUser.id);
        discovery = {
          attempted: true,
          ok: result.ok,
          newlyCreatedCount: result.newlyCreatedIds.length,
          newlyCreatedIds: result.newlyCreatedIds,
          missingCount: result.missingIds.length,
          missingIds: result.missingIds,
          errorMessage: result.ok ? null : "runDiscoveryForConnection returned ok=false — see server logs",
        };
      } catch (err) {
        discovery = {
          ...discovery,
          attempted: true,
          ok: false,
          errorMessage: `Discovery threw: ${err instanceof Error ? err.message : "unknown"}`,
        };
      }
    } else if (!isActive) {
      probe.errorMessage = `Connection is ${conn.connectionStatus} — skipped (reconnect required)`;
      discovery.errorMessage = `Skipped — connection is ${conn.connectionStatus}`;
    }

    const { accessTokenEncrypted: _removed, ...safeConn } = conn;
    void _removed;

    perConnection.push({
      connectionId: safeConn.id,
      env: safeConn.env,
      connectionStatus: safeConn.connectionStatus,
      brokerUserId: safeConn.brokerUserId,
      tokenExpiresAt: safeConn.tokenExpiresAt?.toISOString() ?? null,
      isActive,
      probe,
      discovery,
    });
  }

  // Snapshot after-state.
  const afterAccounts = await prisma.connectedAccount.findMany({
    where: { userId: currentUser.id, platform: "tradovate" },
    select: {
      id: true,
      label: true,
      externalAccountId: true,
      protectionStatus: true,
      missingFromBrokerSince: true,
      brokerConnectionId: true,
    },
  });
  const afterPendingCount = afterAccounts.filter((a) => a.protectionStatus === "pending_decision").length;
  const afterMissingCount = afterAccounts.filter((a) => a.missingFromBrokerSince != null).length;

  const totalSynced = perConnection.filter((c) => c.discovery.attempted && c.discovery.ok).length;
  const totalErrors = perConnection.filter((c) => c.discovery.attempted && !c.discovery.ok).length;
  const totalSkipped = perConnection.filter((c) => !c.isActive).length;
  const totalNewPending = perConnection.reduce((s, c) => s + c.discovery.newlyCreatedCount, 0);
  const totalNewMissing = perConnection.reduce((s, c) => s + c.discovery.missingCount, 0);

  // High-level diagnosis.
  const diagnosis: string[] = [];
  if (!configReady) {
    diagnosis.push("BLOCKED: Tradovate env config is not ready. Check TRADOVATE_CLIENT_ID, TRADOVATE_CLIENT_SECRET, TRADOVATE_TOKEN_ENCRYPTION_KEY.");
  }
  const expiredConns = perConnection.filter((c) =>
    c.connectionStatus === "expired" || c.connectionStatus === "connection_error",
  );
  if (expiredConns.length > 0) {
    diagnosis.push(
      `RECONNECT NEEDED: ${expiredConns.length} connection(s) are expired/error (${expiredConns.map((c) => `${c.connectionId.slice(0, 8)}… ${c.env}`).join(", ")}). No accounts were synced for these.`,
    );
  }
  const demoOnly = perConnection.filter((c) => c.env === "demo" && c.isActive);
  const liveActive = perConnection.filter((c) => c.env === "live" && c.isActive);
  if (demoOnly.length > 0 && liveActive.length === 0) {
    diagnosis.push(
      `DEMO ONLY: All active connections are demo env. If the new account is a live/funded account, reconnect Tradovate with the live env.`,
    );
  }
  for (const c of perConnection.filter((c) => c.isActive)) {
    const inList = c.probe.accounts ?? [];
    const allInactive = inList.length > 0 && inList.every((a) => !a.active);
    if (allInactive) {
      diagnosis.push(
        `INACTIVE ACCOUNTS: Connection ${c.connectionId.slice(0, 8)}… (${c.env}) — Tradovate returned ${inList.length} account(s) but all have active=false. The prop firm may not have activated the new account yet.`,
      );
    }
    const noAccounts = c.probe.attempted && (c.probe.accounts?.length ?? 0) === 0 && !c.probe.errorMessage;
    if (noAccounts) {
      diagnosis.push(
        `EMPTY LIST: Connection ${c.connectionId.slice(0, 8)}… (${c.env}) — /account/list returned an empty array. The OAuth token may not grant access to any accounts under this Tradovate user.`,
      );
    }
  }
  if (totalNewPending > 0) {
    diagnosis.push(
      `NEW ACCOUNTS: ${totalNewPending} account(s) were inserted as pending_decision. They should now appear in the dashboard "New broker account detected" panel.`,
    );
  }
  if (diagnosis.length === 0) {
    diagnosis.push("OK: All active connections synced without errors. No new accounts were found.");
  }

  return NextResponse.json({
    userId: currentUser.id,
    runAt: new Date().toISOString(),
    summary: {
      connectionsFound: connections.length,
      connectionsSynced: totalSynced,
      connectionsWithErrors: totalErrors,
      connectionsSkipped: totalSkipped,
      accountsInsertedAsPendingDecision: totalNewPending,
      accountsMarkedMissing: totalNewMissing,
      pendingDecisionBefore: beforePendingCount,
      pendingDecisionAfter: afterPendingCount,
      missingBefore: beforeMissingCount,
      missingAfter: afterMissingCount,
    },
    diagnosis,
    perConnection,
    // Current pending_decision rows (what dashboard will show).
    currentPendingDecision: afterAccounts
      .filter((a) => a.protectionStatus === "pending_decision")
      .map((a) => ({
        id: a.id,
        label: a.label,
        externalAccountId: a.externalAccountId,
        brokerConnectionId: a.brokerConnectionId,
      })),
  });
}
